import type { RecommendationExperimentDto } from '@/shared/contracts/recommendation-experiment'
import { assignArm, periodKey, type ExperimentSettings } from './assignment'
import { evaluateOutcome, type StageClosure } from './outcome'
import { buildExperimentReport, type ReportSettings, type ReportSignal } from './report'

/**
 * Симуляция эксперимента с известным эффектом (решение 136, `npm run recs:experiment-sim`).
 *
 * Сигналы и исходы выдуманы генератором псевдослучайных чисел с фиксированным зерном,
 * а назначение в группу, исход и отчёт считаются тем же кодом, что и на настоящих данных.
 * Так видно, что оценка находит эффект, который в неё заложили, и не находит тот, которого нет.
 */

/** Mulberry32 — 32-битный генератор: одно зерно — одна и та же последовательность. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Число событий за день по Пуассону (метод Кнута — для небольших средних). */
function poisson(random: () => number, mean: number): number {
  const limit = Math.exp(-mean)
  let k = 0
  let product = random()
  while (product > limit) {
    k += 1
    product *= random()
  }
  return k
}

export interface SimulationScenario {
  name: string
  seed: number
  /** Сколько дней идут сигналы. */
  days: number
  /** Среднее число допустимых сигналов в день. */
  signalsPerDay: number
  /** Вероятность сдвига за H дней без рекомендации и с ней. */
  pControl: number
  pTreatment: number
  controlShare: number
  horizonDays: number
}

const DAY_MS = 24 * 60 * 60 * 1000
/** Начало симуляции — фиксированное, чтобы периоды назначения тоже воспроизводились. */
const START = Date.UTC(2026, 0, 1)
const RULES = ['cooperation.stalled', 'program.missing-metrics', 'skill.critical-gap-with-product'] as const

export interface SimulationResult {
  scenario: SimulationScenario
  report: RecommendationExperimentDto
  /** Заложенная разность долей pT − pC. */
  trueLift: number
}

export function simulate(scenario: SimulationScenario, reportSettings: Omit<ReportSettings, 'enabled' | 'controlShare' | 'horizonDays'>): SimulationResult {
  const random = mulberry32(scenario.seed)
  const settings: ExperimentSettings = {
    enabled: true,
    controlShare: scenario.controlShare,
    horizonDays: scenario.horizonDays,
    salt: `sim-${scenario.seed}`,
    neverControlRules: [],
  }
  const now = new Date(START + scenario.days * DAY_MS)
  const closures = new Map<string, StageClosure[]>()
  const signals: Array<Omit<ReportSignal, 'outcome'> & { entityId: string }> = []

  let counter = 0
  for (let day = 0; day < scenario.days; day += 1) {
    const count = poisson(random, scenario.signalsPerDay)
    for (let i = 0; i < count; i += 1) {
      counter += 1
      const firedAt = new Date(START + (day + random()) * DAY_MS)
      const ruleType = RULES[Math.floor(random() * RULES.length)]!
      const entityId = `sim-${counter}`
      const { arm, assignedBy } = assignArm(
        { ruleType, entityType: 'Cooperation', entityId, periodKey: periodKey(firedAt, scenario.horizonDays) },
        { priority: 'MEDIUM' },
        'none',
        settings,
      )
      // Исход «в мире»: сдвинулась ли связка за окно и когда. С рекомендацией вероятность выше.
      const p = arm === 'treatment' ? scenario.pTreatment : scenario.pControl
      if (random() < p) {
        const at = new Date(firedAt.getTime() + (0.05 + random() * 0.95) * scenario.horizonDays * DAY_MS)
        closures.set(entityId, [{ stageNumber: 3, at }])
      } else {
        random()
      }
      signals.push({ ruleType, arm, assignedBy, firedAt, controlShare: scenario.controlShare, entityId })
    }
  }

  const facts = { stageClosures: closures, programEvents: new Map() }
  const withOutcomes: ReportSignal[] = signals.map(({ entityId, ...signal }) => ({
    ...signal,
    outcome: evaluateOutcome(
      { entityType: 'Cooperation', entityId, firedAt: signal.firedAt, context: { stageNumber: 3 } },
      facts,
      now,
      scenario.horizonDays,
    ),
  }))

  const report = buildExperimentReport(
    withOutcomes,
    { ...reportSettings, enabled: true, controlShare: scenario.controlShare, horizonDays: scenario.horizonDays },
    now,
  )
  return { scenario, report, trueLift: scenario.pTreatment - scenario.pControl }
}

export interface Calibration {
  runs: number
  /** Доля прогонов, где 95 % интервал накрыл заложенную разность. */
  coverage: number
  /** Доля прогонов со статусом «прирост есть». */
  liftShare: number
  /** Доля прогонов, где проверка Вальда остановилась с «прирост есть». */
  sequentialLiftShare: number
}

/** Много прогонов с разными зёрнами: как часто интервал накрывает правду и как часто находится прирост. */
export function calibrate(
  scenario: SimulationScenario,
  reportSettings: Omit<ReportSettings, 'enabled' | 'controlShare' | 'horizonDays'>,
  runs: number,
): Calibration {
  let covered = 0
  let lift = 0
  let sequentialLift = 0
  for (let run = 0; run < runs; run += 1) {
    const { report, trueLift } = simulate({ ...scenario, seed: scenario.seed + run * 7919 }, reportSettings)
    const ci = report.overall.ci
    if (ci && ci.low <= trueLift && trueLift <= ci.high) covered += 1
    if (report.overall.status === 'lift') lift += 1
    if (report.overall.sequential.decision === 'lift') sequentialLift += 1
  }
  return { runs, coverage: covered / runs, liftShare: lift / runs, sequentialLiftShare: sequentialLift / runs }
}
