/**
 * Прогноз связок — сервисный слой (решение 135): права, сбор данных, DTO наружу.
 * Математика — forecast-math.ts/forecast-model.ts, признаки и объяснение —
 * forecast-features.ts/forecast-explain.ts, данные — forecast.repo.ts.
 *
 * Права — как у остальной аналитики (`ANALYTICS`): представителю вуза не видны
 * даже собственные прогнозы связок — это внутренняя оценка ИТ-Школы, а не то,
 * чем с вузом делятся, как рейтинг программ и рейтинг вуза (analytics.service.ts).
 */

import type { CurrentUser } from '@/shared/auth/current-user'
import { assertCan } from '@/shared/auth/permissions'
import { notFound } from '@/shared/http/errors'
import { writeAudit } from '@/shared/audit/audit'
import { FORECAST, FORECAST_MILESTONES, type ForecastMilestone } from '@/shared/config/forecast.config'
import {
  FORECAST_MODEL_STATUS_LABELS,
  type CooperationForecastDto,
  type ForecastCoefficientDto,
  type ForecastDriftDto,
  type ForecastMetricsDto,
  type ForecastModelDto,
  type ForecastModelsDto,
} from '@/shared/contracts/forecast'
import * as repo from './forecast.repo'
import {
  FEATURE_KEYS,
  FEATURE_TITLES,
  currentFeatures,
  isEligible,
  peersAt,
  truncateTimeline,
  type CooperationTimeline,
  type FeatureVector,
} from './forecast-features'
import { trainMilestoneModel, type ForecastMetrics } from './forecast-model'
import {
  computeDrift,
  forecastCooperation,
  milestoneDto,
  staleReasons,
  type DriftVerdict,
  type StoredModel,
} from './forecast-explain'
import { storedStageMedians, type ExternalStageMedian } from './stage-duration'
import { ensureStageDurations } from './stage-analytics.service'
import { cachedStageDurations } from './stalled-threshold'

/**
 * Медиана этапа из аналитики этапов (Каплан–Мейер, решение 120) — основной источник
 * для признака «дней на этапе к медиане» (решение 135). `until` не учитывается: сводки
 * в памяти — это оценка по всей текущей истории, а не на дату снимка (пересчитывать
 * Каплана–Мейера на каждую историческую дату было бы дорого ради нормировки одного
 * признака). Влияет только на масштаб признака, не на метку и не на утечку будущего.
 * Пусто или недостаточно данных по этапу (`status !== 'ok'`) — `null`, и `stageMedians`
 * (stage-duration.ts) сама уходит в запасной расчёт по истории связок или норматив.
 */
const externalStageMedian: ExternalStageMedian = (stageNumber) => {
  const summary = cachedStageDurations()?.get(stageNumber)
  if (!summary || summary.status !== 'ok') return null
  return summary.median.day
}

/** Предыдущая веха по порядку — для правила «предыдущая веха уже пройдена». */
function previousOf(milestone: ForecastMilestone): ForecastMilestone | null {
  const index = FORECAST_MILESTONES.indexOf(milestone)
  return index > 0 ? FORECAST_MILESTONES[index - 1]! : null
}

/**
 * Обучает модели всех вех разом на одной и той же истории — иначе они считали бы
 * снимки в разные моменты и метрики двух вех были бы несравнимы на одном слайде.
 *
 * `userId` — кто запустил: пользователь через API или `null` для системного запуска
 * (`npm run forecast:train`, cron через сервис migrate — как `audit.retention`).
 */
export async function runTraining(userId: string | null): Promise<ForecastModelsDto> {
  const now = new Date()
  // Свежие сводки Каплана–Мейера перед обучением: без него геттер отдавал бы
  // устаревший или пустой кэш (решение 120 обновляет его сам только по запросу
  // пересборки рекомендаций, пульса и предпросмотра — обучение прогноза сюда не входит).
  await ensureStageDurations(now)
  const timelines = await repo.fetchTrainingTimelines()

  const stored: StoredModel[] = []
  for (const milestone of FORECAST_MILESTONES) {
    const trained = trainMilestoneModel(timelines, milestone, previousOf(milestone), now, {
      externalMedian: externalStageMedian,
    })
    stored.push(await repo.saveTrainedModel(trained, now))
  }

  await writeAudit({
    userId,
    action: 'forecast.model.train',
    objectType: 'ForecastModel',
    objectId: 'all',
    payload: {
      cooperations: timelines.length,
      models: stored.map((item) => ({
        milestoneStage: item.milestoneStage,
        status: item.status,
        version: item.version,
        auc: item.metrics.auc,
        n: item.metrics.n,
      })),
    },
  })

  return buildModelsDto(stored, timelines, now)
}

/** Обучение по запросу администратора через API. */
export async function trainModels(user: CurrentUser): Promise<ForecastModelsDto> {
  assertCan(user, 'ADMIN')
  return runTraining(user.id)
}

/** Метрики модели, как их видит фронт: без внутренних полей (allSnapshots, isMock — свои у DTO). */
function toMetricsDto(metrics: ForecastMetrics): ForecastMetricsDto {
  return {
    auc: metrics.auc,
    aucLower: metrics.aucLower,
    baselineAuc: metrics.baselineAuc,
    brier: metrics.brier,
    baselineBrier: metrics.baselineBrier,
    n: metrics.n,
    positives: metrics.positives,
    cooperations: metrics.cooperations,
    trainN: metrics.trainN,
    trainPositives: metrics.trainPositives,
    splitAt: metrics.splitAt,
    calibration: metrics.calibration,
    gate: metrics.gate,
    iterations: metrics.iterations,
    converged: metrics.converged,
    lambda: metrics.lambda,
  }
}

function buildCoefficientDtos(stored: StoredModel): ForecastCoefficientDto[] {
  const { coefficients, featureStats } = stored
  if (!coefficients || !featureStats.features) return []
  return FEATURE_KEYS.map((key) => {
    const stat = featureStats.features![key]
    const weight = coefficients.weights[key]
    return {
      feature: key,
      title: FEATURE_TITLES[key],
      weight,
      oddsRatio: Math.exp(weight),
      mean: stat.mean,
      std: stat.std,
    }
  })
}

/** Открытые связки, для которых прогноз к этой вехе вообще имеет смысл, — образец для PSI. */
function currentFeatureSample(
  timelines: readonly CooperationTimeline[],
  milestone: ForecastMilestone,
  now: Date,
  stored: StoredModel,
): FeatureVector[] {
  const previous = previousOf(milestone)
  const medians = storedStageMedians(stored.featureStats.stageMedians)
  const sample: FeatureVector[] = []
  for (const timeline of timelines) {
    const truncated = truncateTimeline(timeline, now)
    if (!isEligible(truncated, now, milestone, previous)) continue
    const peers = peersAt(timelines, timeline.universityId)
    const features = currentFeatures(timeline, peers, now, medians)
    if (features) sample.push(features)
  }
  return sample
}

function toModelDto(milestone: ForecastMilestone, stored: StoredModel | null, drift: DriftVerdict, now: Date): ForecastModelDto {
  if (!stored) {
    return {
      milestone: milestoneDto(milestone),
      horizonDays: milestone.horizonDays,
      version: null,
      trainedAt: null,
      status: 'insufficient_data',
      statusLabel: FORECAST_MODEL_STATUS_LABELS.insufficient_data,
      isStale: false,
      staleReasons: [],
      metrics: null,
      intercept: null,
      coefficients: [],
      drift: [],
      driftSample: 0,
      isMock: false,
    }
  }

  const reasons = staleReasons(stored.trainedAt, now, drift)
  const driftDtos: ForecastDriftDto[] = FEATURE_KEYS.map((key) => ({
    feature: key,
    title: FEATURE_TITLES[key],
    psi: drift.psi?.[key] ?? null,
  }))

  return {
    milestone: milestoneDto(milestone),
    horizonDays: stored.horizonDays,
    version: stored.version,
    trainedAt: stored.trainedAt.toISOString(),
    status: stored.status,
    statusLabel: FORECAST_MODEL_STATUS_LABELS[stored.status],
    isStale: reasons.length > 0,
    staleReasons: reasons,
    metrics: toMetricsDto(stored.metrics),
    intercept: stored.coefficients?.intercept ?? null,
    coefficients: buildCoefficientDtos(stored),
    drift: driftDtos,
    driftSample: drift.sample,
    isMock: stored.metrics.isMock,
  }
}

function buildModelsDto(stored: StoredModel[], timelines: CooperationTimeline[], now: Date): ForecastModelsDto {
  const byStage = new Map(stored.map((item) => [item.milestoneStage, item]))
  const models = FORECAST_MILESTONES.map((milestone) => {
    const model = byStage.get(milestone.stageNumber) ?? null
    const drift =
      model && model.featureStats.features
        ? computeDrift(
            model.featureStats.features,
            currentFeatureSample(timelines, milestone, now, model),
            FORECAST.psiMinCurrent,
          )
        : { psi: null, sample: 0 }
    return toModelDto(milestone, model, drift, now)
  })
  return { models, generatedAt: now.toISOString() }
}

/**
 * Метрики и коэффициенты обеих вех — без проверки прав: для `npm run forecast:report`
 * (печать для слайда презентации) и для `getModels` (API, с проверкой прав ниже).
 */
export async function readModels(): Promise<ForecastModelsDto> {
  const now = new Date()
  const stored = await repo.fetchLatestModels()
  const models = [...stored.values()]
  const needsDrift = models.some((item) => item.featureStats.features !== null)
  const timelines = needsDrift ? await repo.fetchTrainingTimelines() : []

  return buildModelsDto(models, timelines, now)
}

/** Метрики и коэффициенты обеих вех — страница «Модель прогноза» (для слайда жюри). */
export async function getModels(user: CurrentUser): Promise<ForecastModelsDto> {
  assertCan(user, 'ANALYTICS')
  return readModels()
}

/**
 * Прогноз одной связки. Право то же, что у остальной аналитики: представителю
 * вуза — 403, как и на `/api/analytics/overview` (permissions.ts, ANALYTICS).
 *
 * Сдвиг признаков (PSI) здесь не считается — это выборка по всем связкам сразу
 * (см. `getModels`), а не то, что стоит пересчитывать на каждый просмотр карточки.
 * Устаревание по возрасту модели проверяется в любом случае.
 */
export async function getCooperationForecast(user: CurrentUser, cooperationId: string): Promise<CooperationForecastDto> {
  assertCan(user, 'ANALYTICS')

  const found = await repo.fetchCooperationWithPeers(cooperationId)
  if (!found) throw notFound('Связка не найдена')

  const models = await repo.fetchLatestModels()
  const now = new Date()
  return forecastCooperation({
    timeline: found.timeline,
    peers: found.peers,
    now,
    status: found.status,
    models,
    drift: new Map(),
  })
}
