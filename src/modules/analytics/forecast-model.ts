/**
 * Обучение и применение модели прогноза (решение 125). Чистые функции: история
 * связок на входе, модель и метрики на выходе. База — в forecast.repo.ts.
 *
 * Порядок обучения (docs/FORECAST_MODEL.md):
 *   1. снимки истории скользящим окном, метка — дошла ли связка до вехи за H дней;
 *   2. временное разбиение: проверка — самые поздние снимки, обучение — только те,
 *      чей исход был известен к началу проверки (t + H ≤ граница);
 *   3. модель (логрегрессия с L2, Ньютон) и правило (частота вехи по этапу) учатся
 *      на ранних снимках и сравниваются на поздних: AUC, Brier, калибровка;
 *   4. ворота публикации;
 *   5. итоговые коэффициенты — по всем снимкам той же процедурой.
 */

import { FORECAST, type ForecastMilestone } from '@/shared/config/forecast.config'
import type { ForecastModelStatus } from '@/shared/contracts/forecast'
import {
  auc,
  aucLowerBound,
  brier,
  calibration,
  fitLogisticNewton,
  fitStandardizer,
  psiBins,
  quantileSorted,
  sigmoid,
  standardize,
  type CalibrationBin,
  type PsiBins,
} from './forecast-math'
import {
  FEATURE_KEYS,
  featurize,
  snapshotPoints,
  toRow,
  type CooperationTimeline,
  type FeatureKey,
  type FeatureVector,
  type Snapshot,
} from './forecast-features'
import { stageMedians, type ExternalStageMedian, type StageMedian } from './stage-duration'

const DAY_MS = 24 * 60 * 60 * 1000

export interface GateCheck {
  key: 'snapshots' | 'positives' | 'negatives' | 'aucGain' | 'aboveChance' | 'training'
  passed: boolean
  text: string
}

export interface ForecastMetrics {
  auc: number | null
  aucLower: number | null
  baselineAuc: number | null
  brier: number | null
  baselineBrier: number | null
  n: number
  positives: number
  cooperations: number
  trainN: number
  trainPositives: number
  splitAt: string | null
  calibration: CalibrationBin[]
  gate: GateCheck[]
  iterations: number | null
  converged: boolean | null
  lambda: number
  /** Сколько снимков всего (с меткой) и сколько из них дошли до вехи. */
  allSnapshots: number
  allPositives: number
  isMock: boolean
}

export interface FeatureStats {
  mean: number
  std: number
  /** 101 квантиль (0%, 1%, … 100%) — для фраз «больше, чем у 80% связок». */
  quantiles: number[]
  psi: PsiBins
}

export interface BaselineRates {
  overall: number | null
  byStage: Record<string, { rate: number; n: number; positives: number }>
}

export interface StoredFeatureStats {
  features: Record<FeatureKey, FeatureStats> | null
  stageMedians: Record<string, StageMedian>
  baseline: BaselineRates
}

export interface StoredCoefficients {
  intercept: number
  weights: Record<FeatureKey, number>
}

/** Модель, как она хранится в forecast_models. */
export interface TrainedForecastModel {
  milestoneStage: number
  horizonDays: number
  status: ForecastModelStatus
  metrics: ForecastMetrics
  coefficients: StoredCoefficients | null
  featureStats: StoredFeatureStats
}

/** Частота вехи по текущему этапу со сглаживанием к общей частоте. */
export function fitBaseline(snapshots: readonly Snapshot[]): BaselineRates {
  if (snapshots.length === 0) return { overall: null, byStage: {} }
  const overall = snapshots.reduce((sum, item) => sum + item.label, 0) / snapshots.length
  const groups = new Map<number, { n: number; positives: number }>()
  for (const item of snapshots) {
    const group = groups.get(item.features.stageNumber) ?? { n: 0, positives: 0 }
    group.n += 1
    group.positives += item.label
    groups.set(item.features.stageNumber, group)
  }
  const alpha = FORECAST.baselineSmoothing
  const byStage: BaselineRates['byStage'] = {}
  for (const [stage, group] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    byStage[String(stage)] = {
      rate: (group.positives + alpha * overall) / (group.n + alpha),
      n: group.n,
      positives: group.positives,
    }
  }
  return { overall, byStage }
}

export function predictBaseline(rates: BaselineRates, stageNumber: number): number | null {
  return rates.byStage[String(stageNumber)]?.rate ?? rates.overall
}

interface Fitted {
  coefficients: StoredCoefficients
  mean: number[]
  std: number[]
  iterations: number
  converged: boolean
}

function fitModel(snapshots: readonly Snapshot[]): Fitted {
  const rows = snapshots.map((item) => toRow(item.features))
  const scaler = fitStandardizer(rows)
  const x = rows.map((row) => standardize(row, scaler))
  const y = snapshots.map((item) => item.label)
  const fit = fitLogisticNewton(x, y, {
    lambda: FORECAST.l2Lambda,
    maxIterations: FORECAST.maxIterations,
    tolerance: FORECAST.tolerance,
  })
  const weights = Object.fromEntries(FEATURE_KEYS.map((key, j) => [key, fit.weights[j]!])) as Record<FeatureKey, number>
  return {
    coefficients: { intercept: fit.intercept, weights },
    mean: scaler.mean,
    std: scaler.std,
    iterations: fit.iterations,
    converged: fit.converged,
  }
}

/** Вклад каждого признака в логит: коэффициент × стандартизованное значение. */
export function contributions(
  coefficients: StoredCoefficients,
  stats: Record<FeatureKey, Pick<FeatureStats, 'mean' | 'std'>>,
  features: FeatureVector,
): Record<FeatureKey, number> {
  const result = {} as Record<FeatureKey, number>
  for (const key of FEATURE_KEYS) {
    const { mean, std } = stats[key]
    const z = std > 1e-12 ? (features[key] - mean) / std : 0
    result[key] = coefficients.weights[key] * z
  }
  return result
}

export function predictModel(
  coefficients: StoredCoefficients,
  stats: Record<FeatureKey, Pick<FeatureStats, 'mean' | 'std'>>,
  features: FeatureVector,
): { probability: number; logit: number; contributions: Record<FeatureKey, number> } {
  const parts = contributions(coefficients, stats, features)
  const value = coefficients.intercept + FEATURE_KEYS.reduce((sum, key) => sum + parts[key], 0)
  return { probability: sigmoid(value), logit: value, contributions: parts }
}

function statsOf(fitted: Fitted): Record<FeatureKey, Pick<FeatureStats, 'mean' | 'std'>> {
  return Object.fromEntries(
    FEATURE_KEYS.map((key, j) => [key, { mean: fitted.mean[j]!, std: fitted.std[j]! }]),
  ) as Record<FeatureKey, Pick<FeatureStats, 'mean' | 'std'>>
}

function featureStats(snapshots: readonly Snapshot[], fitted: Fitted): Record<FeatureKey, FeatureStats> {
  const result = {} as Record<FeatureKey, FeatureStats>
  FEATURE_KEYS.forEach((key, j) => {
    const values = snapshots.map((item) => item.features[key])
    const sorted = [...values].sort((a, b) => a - b)
    result[key] = {
      mean: fitted.mean[j]!,
      std: fitted.std[j]!,
      quantiles: Array.from({ length: 101 }, (_, q) => quantileSorted(sorted, q / 100)),
      psi: psiBins(values, FORECAST.psiBins),
    }
  })
  return result
}

const hasBothClasses = (items: readonly Snapshot[], minimum: number) => {
  const positives = items.filter((item) => item.label === 1).length
  return items.length >= FORECAST.minTrainSnapshots && positives >= minimum && items.length - positives >= minimum
}

const format = (value: number) => value.toFixed(3).replace('.', ',')

/**
 * Ворота публикации. Первые три — хватает ли проверочной выборки, чтобы метрикам
 * вообще верить; последние две — лучше ли модель простого правила и угадывания.
 */
export function evaluateGate(input: {
  trainingOk: boolean
  n: number
  positives: number
  modelAuc: number | null
  modelAucLower: number | null
  baselineAuc: number | null
}): { status: ForecastModelStatus; checks: GateCheck[] } {
  const { gate } = FORECAST
  const negatives = input.n - input.positives
  const checks: GateCheck[] = [
    {
      key: 'training',
      passed: input.trainingOk,
      text: input.trainingOk
        ? 'На ранних снимках хватило данных обоих исходов, чтобы обучить модель'
        : `На ранних снимках меньше ${FORECAST.minTrainSnapshots} снимков или меньше ${FORECAST.minTrainPositives} каждого исхода — модель не обучалась`,
    },
    {
      key: 'snapshots',
      passed: input.n >= gate.minSnapshots,
      text: `Снимков на проверке: ${input.n}, нужно не меньше ${gate.minSnapshots}`,
    },
    {
      key: 'positives',
      passed: input.positives >= gate.minPositives,
      text: `Дошли до вехи: ${input.positives}, нужно не меньше ${gate.minPositives}`,
    },
    {
      key: 'negatives',
      passed: negatives >= gate.minNegatives,
      text: `Не дошли: ${negatives}, нужно не меньше ${gate.minNegatives}`,
    },
  ]
  const enoughData = checks.every((check) => check.passed)

  const gain =
    input.modelAuc !== null && input.baselineAuc !== null ? input.modelAuc - input.baselineAuc : null
  const gainOk = gain !== null && gain >= gate.minAucGain - 1e-12
  checks.push({
    key: 'aucGain',
    passed: gainOk,
    text:
      gain === null
        ? 'AUC не посчитан: на проверке нет обоих исходов'
        : `AUC модели ${format(input.modelAuc!)} против ${format(input.baselineAuc!)} у правила — нужно выше хотя бы на ${format(gate.minAucGain)}`,
  })
  const chanceOk = input.modelAucLower !== null && input.modelAucLower > 0.5
  checks.push({
    key: 'aboveChance',
    passed: chanceOk,
    text:
      input.modelAucLower === null
        ? 'Интервал AUC не посчитан'
        : `Нижняя граница 95% интервала AUC — ${format(input.modelAucLower)}, нужно выше 0,5 (лучше угадывания)`,
  })

  const status: ForecastModelStatus = !enoughData
    ? 'insufficient_data'
    : gainOk && chanceOk
      ? 'published'
      : 'baseline_better'
  return { status, checks }
}

/** Граница разбиения: дата, с которой начинаются последние `validationShare` снимков. */
function splitDate(dates: readonly Date[]): Date | null {
  if (dates.length === 0) return null
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime())
  const index = Math.min(Math.floor(sorted.length * (1 - FORECAST.validationShare)), sorted.length - 1)
  return sorted[index]!
}

export interface TrainOptions {
  /** Медиана этапа из аналитики этапов, если она подключена (см. stage-duration.ts). */
  externalMedian?: ExternalStageMedian
}

/** Обучение модели одной вехи. `now` — дата данных: метки позже now − H неизвестны. */
export function trainMilestoneModel(
  timelines: readonly CooperationTimeline[],
  milestone: ForecastMilestone,
  previousMilestone: ForecastMilestone | null,
  now: Date,
  options: TrainOptions = {},
): TrainedForecastModel {
  const points = snapshotPoints(timelines, now, milestone, previousMilestone)
  const splitAt = splitDate(points.map((point) => point.at))
  const horizonMs = milestone.horizonDays * DAY_MS
  const isMock = timelines.some((item) => item.isMock)

  // Проверка: поздние снимки. Обучение: только снимки, чей исход известен к границе.
  const mediansAtSplit = stageMedians(timelines, splitAt ?? now, options.externalMedian)
  const validation = splitAt
    ? featurize(points.filter((point) => point.at >= splitAt), timelines, mediansAtSplit)
    : []
  const training = splitAt
    ? featurize(
        points.filter((point) => point.at.getTime() + horizonMs <= splitAt.getTime()),
        timelines,
        mediansAtSplit,
      )
    : []

  const trainPositives = training.filter((item) => item.label === 1).length
  const positives = validation.filter((item) => item.label === 1).length
  const labels = validation.map((item) => item.label)
  const trainingOk = hasBothClasses(training, FORECAST.minTrainPositives)

  let modelAuc: number | null = null
  let modelAucLower: number | null = null
  let modelBrier: number | null = null
  let modelCalibration: CalibrationBin[] = calibration([], [], FORECAST.calibrationBins)
  let iterations: number | null = null
  let converged: boolean | null = null

  const baselineEarly = fitBaseline(training)
  const baselineScores = validation.map(
    (item) => predictBaseline(baselineEarly, item.features.stageNumber) ?? 0,
  )
  const baselineAuc = training.length > 0 ? auc(baselineScores, labels) : null
  const baselineBrier = training.length > 0 ? brier(baselineScores, labels) : null

  if (trainingOk && validation.length > 0) {
    const early = fitModel(training)
    iterations = early.iterations
    converged = early.converged
    const stats = statsOf(early)
    const scores = validation.map((item) => predictModel(early.coefficients, stats, item.features).probability)
    modelAuc = auc(scores, labels)
    modelBrier = brier(scores, labels)
    modelCalibration = calibration(scores, labels, FORECAST.calibrationBins)
    if (modelAuc !== null) modelAucLower = aucLowerBound(modelAuc, positives, validation.length - positives)
  }

  const gate = evaluateGate({
    trainingOk,
    n: validation.length,
    positives,
    modelAuc,
    modelAucLower,
    baselineAuc,
  })

  // Итог — та же процедура на всех снимках с известным исходом и медианах на сегодня.
  const mediansNow = stageMedians(timelines, now, options.externalMedian)
  const all = featurize(points, timelines, mediansNow)
  const allPositives = all.filter((item) => item.label === 1).length
  let coefficients: StoredCoefficients | null = null
  let features: Record<FeatureKey, FeatureStats> | null = null
  if (hasBothClasses(all, FORECAST.minTrainPositives)) {
    const final = fitModel(all)
    coefficients = final.coefficients
    features = featureStats(all, final)
  }

  return {
    milestoneStage: milestone.stageNumber,
    horizonDays: milestone.horizonDays,
    status: coefficients === null ? 'insufficient_data' : gate.status,
    metrics: {
      auc: modelAuc,
      aucLower: modelAucLower,
      baselineAuc,
      brier: modelBrier,
      baselineBrier,
      n: validation.length,
      positives,
      cooperations: new Set(validation.map((item) => item.cooperationId)).size,
      trainN: training.length,
      trainPositives,
      splitAt: splitAt?.toISOString() ?? null,
      calibration: modelCalibration,
      gate: gate.checks,
      iterations,
      converged,
      lambda: FORECAST.l2Lambda,
      allSnapshots: all.length,
      allPositives,
      isMock,
    },
    coefficients,
    featureStats: {
      features,
      stageMedians: mediansNow.toJSON(),
      baseline: fitBaseline(all),
    },
  }
}
