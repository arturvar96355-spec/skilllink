/**
 * Прогноз одной связки и его объяснение обычными словами (решение 135).
 *
 * Вклад признака — коэффициент × стандартизованное значение. Сумма вкладов
 * всех признаков плюс свободный член — это логит, из которого получается
 * вероятность: объяснение складывается ровно в число, а не рассказывает
 * о нём что-то приблизительное.
 */

import { FORECAST, FORECAST_MILESTONES, type ForecastMilestone } from '@/shared/config/forecast.config'
import { STAGE_BY_NUMBER } from '@/shared/config/workflow.config'
import {
  FORECAST_STATUS_LABELS,
  type CooperationForecastDto,
  type ForecastExplanationItemDto,
  type ForecastStatus,
} from '@/shared/contracts/forecast'
import { countWithNoun, plural } from '@/shared/utils/text'
import { psi, shareBelowAbove } from './forecast-math'
import {
  FEATURE_KEYS,
  FEATURE_TITLES,
  currentFeatures,
  isMilestoneReached,
  truncateTimeline,
  type CooperationTimeline,
  type FeatureKey,
  type FeatureVector,
  type PeerCooperation,
} from './forecast-features'
import { predictBaseline, predictModel, type StoredFeatureStats, type TrainedForecastModel } from './forecast-model'
import { storedStageMedians } from './stage-duration'

const DAY_FORMS = ['день', 'дня', 'дней'] as const
const MEETING_FORMS = ['встреча', 'встречи', 'встреч'] as const
const STAGE_FORMS = ['этап', 'этапа', 'этапов'] as const
const COOPERATION_FORMS = ['действующая связка', 'действующие связки', 'действующих связок'] as const
const RECOMMENDATION_FORMS = ['рекомендация', 'рекомендации', 'рекомендаций'] as const
const CASE_FORMS_OF = ['случая', 'случаев', 'случаев'] as const

export function formatDecimal(value: number, digits = 1): string {
  return (Math.round(value * 10 ** digits) / 10 ** digits).toString().replace('.', ',')
}

const percentText = (share: number) => `${Math.round(share * 100)}%`

/** «— больше, чем у 80% связок» по квантилям обучающей выборки. */
function comparison(quantiles: readonly number[] | undefined, value: number, more: string, less: string): string {
  if (!quantiles || quantiles.length === 0) return ''
  const { below, above } = shareBelowAbove(quantiles, value)
  if (below >= 0.5) return ` — ${more}, чем у ${percentText(below)} связок`
  if (above >= 0.5) return ` — ${less}, чем у ${percentText(above)} связок`
  return ' — как у большинства связок'
}

const stageTitle = (stageNumber: number) => STAGE_BY_NUMBER.get(stageNumber)?.title ?? `Этап ${stageNumber}`

/** Фраза о значении признака у связки. */
export function describeFeature(
  key: FeatureKey,
  features: FeatureVector,
  context: {
    milestone: ForecastMilestone
    quantiles?: Partial<Record<FeatureKey, number[]>>
    stageMedianDays?: number
  },
): string {
  const value = features[key]
  const q = context.quantiles?.[key]
  switch (key) {
    case 'stageNumber': {
      const left = context.milestone.stageNumber - value
      return left <= 0
        ? `Связка на этапе ${value} «${stageTitle(value)}» — это этап вехи`
        : `Связка на этапе ${value} «${stageTitle(value)}», до этапа ${context.milestone.stageNumber} ещё ${countWithNoun(left, STAGE_FORMS)}`
    }
    case 'stageDurationRatio': {
      const median = context.stageMedianDays
      const onStage = median !== undefined ? Math.round(value * median) : null
      const head = onStage !== null ? `На текущем этапе ${countWithNoun(onStage, DAY_FORMS)}` : 'Время на текущем этапе'
      const tail = median !== undefined ? ` (обычно — ${countWithNoun(Math.round(median), DAY_FORMS)})` : ''
      if (value >= 1.2) return `${head} — в ${formatDecimal(value)} раза дольше обычного${tail}`
      if (value <= 0.8) return `${head} — быстрее обычного${tail}`
      return `${head} — как обычно${tail}`
    }
    case 'meetings30':
      return value === 0
        ? `Ни одной встречи за месяц${comparison(q, value, 'больше', 'меньше')}`
        : `${countWithNoun(value, MEETING_FORMS)} за месяц${comparison(q, value, 'больше', 'меньше')}`
    case 'meetings90':
      return value === 0
        ? `Ни одной встречи за три месяца${comparison(q, value, 'больше', 'меньше')}`
        : `${countWithNoun(value, MEETING_FORMS)} за три месяца${comparison(q, value, 'больше', 'меньше')}`
    case 'daysSinceActivity': {
      const whole = Math.floor(value)
      return whole === 0
        ? `Последняя активность — сегодня${comparison(q, value, 'дольше', 'меньше')}`
        : `${countWithNoun(whole, DAY_FORMS)} без активности${comparison(q, value, 'дольше', 'меньше')}`
    }
    case 'stageTasksDoneShare':
      return `Закрыто ${percentText(value)} пунктов текущего этапа${comparison(q, value, 'больше', 'меньше')}`
    case 'documentsInReview':
      return value ? 'Есть документы на согласовании' : 'Нет документов на согласовании'
    case 'regionCapital':
      return value ? 'Вуз в Москве или Санкт-Петербурге' : 'Вуз не в Москве и не в Санкт-Петербурге'
    case 'levelSpo':
      return value ? 'Программа СПО' : 'Программа высшего образования, не СПО'
    case 'levelMaster':
      return value ? 'Программа магистратуры или аспирантуры' : 'Программа не магистратуры'
    case 'universityActiveCooperations':
      return value === 0 ? 'Других действующих связок у вуза нет' : `У вуза ещё ${countWithNoun(value, COOPERATION_FORMS)}`
    case 'hadBlock':
      return value ? 'Этапы связки уже блокировались' : 'Этапы связки не блокировались'
    case 'dismissedRecommendations':
      return value === 0
        ? 'Отклонённых рекомендаций по связке нет'
        : `Отклонено ${value} ${plural(value, RECOMMENDATION_FORMS)} по связке`
  }
}

/** Топ «за» и «против» по вкладам: по убыванию силы, не больше `top` с каждой стороны. */
export function explainContributions(
  parts: Record<FeatureKey, number>,
  features: FeatureVector,
  context: Parameters<typeof describeFeature>[2],
  top: number = FORECAST.explanationTop,
): ForecastExplanationItemDto[] {
  const items = FEATURE_KEYS.filter((key) => Math.abs(parts[key]) > 1e-6).map((key) => ({
    feature: key,
    title: FEATURE_TITLES[key],
    value: features[key],
    contribution: parts[key],
    direction: (parts[key] > 0 ? 'for' : 'against') as 'for' | 'against',
    text: describeFeature(key, features, context),
  }))
  const pros = items.filter((item) => item.direction === 'for').sort((a, b) => b.contribution - a.contribution)
  const cons = items.filter((item) => item.direction === 'against').sort((a, b) => a.contribution - b.contribution)
  return [...pros.slice(0, top), ...cons.slice(0, top)]
}

export interface DriftVerdict {
  /** PSI по признакам; null — текущих связок мало, сдвиг не считался. */
  psi: Partial<Record<FeatureKey, number>> | null
  sample: number
}

/**
 * Сдвиг признаков: PSI текущих открытых связок против распределения обучения
 * (корзины из `featureStats`, решение 135). Меньше `psiMinCurrent` текущих
 * связок — сдвиг не считается: на горстке случайных значений PSI — шум,
 * а не сигнал (config.psiMinCurrent).
 */
export function computeDrift(
  features: StoredFeatureStats['features'],
  currentFeatureVectors: readonly FeatureVector[],
  minSample: number,
): DriftVerdict {
  if (!features || currentFeatureVectors.length < minSample) {
    return { psi: null, sample: currentFeatureVectors.length }
  }
  const byFeature = {} as Partial<Record<FeatureKey, number>>
  for (const key of FEATURE_KEYS) {
    byFeature[key] = psi(
      features[key].psi,
      currentFeatureVectors.map((item) => item[key]),
    )
  }
  return { psi: byFeature, sample: currentFeatureVectors.length }
}

/** Устарела ли модель: давно обучена или признаки сдвинулись. Причины — словами. */
export function staleReasons(trainedAt: Date, now: Date, drift: DriftVerdict | null): string[] {
  const reasons: string[] = []
  const ageDays = Math.floor((now.getTime() - trainedAt.getTime()) / (24 * 60 * 60 * 1000))
  if (ageDays > FORECAST.staleAfterDays) {
    reasons.push(`Модель обучена ${countWithNoun(ageDays, DAY_FORMS)} назад — дольше ${FORECAST.staleAfterDays} дней`)
  }
  for (const [key, value] of Object.entries(drift?.psi ?? {}) as Array<[FeatureKey, number]>) {
    if (value > FORECAST.psiThreshold) {
      reasons.push(
        `Сильно сдвинулся признак «${FEATURE_TITLES[key]}»: PSI ${formatDecimal(value, 2)} выше ${formatDecimal(FORECAST.psiThreshold, 2)}`,
      )
    }
  }
  return reasons
}

export interface StoredModel extends TrainedForecastModel {
  version: number
  trainedAt: Date
}

/** Первая ещё не пройденная веха и предыдущая перед ней. */
export function nextMilestone(
  truncated: CooperationTimeline,
): { milestone: ForecastMilestone; previous: ForecastMilestone | null } | null {
  for (let i = 0; i < FORECAST_MILESTONES.length; i += 1) {
    const milestone = FORECAST_MILESTONES[i]!
    if (!isMilestoneReached(truncated, milestone.stageNumber)) {
      return { milestone, previous: i > 0 ? FORECAST_MILESTONES[i - 1]! : null }
    }
  }
  return null
}

/** DTO вехи — используется и объяснением связки, и страницей модели. */
export function milestoneDto(milestone: ForecastMilestone) {
  return {
    stageNumber: milestone.stageNumber,
    stageTitle: stageTitle(milestone.stageNumber),
    goal: milestone.goal,
  }
}

/**
 * Прогноз для одной связки на дату `now`.
 *
 * `paused` — связка сейчас на паузе: истории пауз в системе нет, модель этого не знает,
 * поэтому это оговорка, а не признак.
 */
export function forecastCooperation(input: {
  timeline: CooperationTimeline
  peers: readonly PeerCooperation[]
  now: Date
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED'
  models: ReadonlyMap<number, StoredModel>
  drift: ReadonlyMap<number, DriftVerdict>
}): CooperationForecastDto {
  const { timeline, now } = input
  const base = {
    cooperationId: timeline.id,
    notes: [] as string[],
    generatedAt: now.toISOString(),
  }
  const empty = (status: ForecastStatus, summary: string): CooperationForecastDto => ({
    ...base,
    milestone: null,
    horizonDays: null,
    probability: null,
    source: 'baseline',
    status,
    statusLabel: FORECAST_STATUS_LABELS[status],
    summary,
    explanation: [],
    modelVersion: null,
    trainedAt: null,
    isMock: timeline.isMock,
  })

  if (input.status === 'COMPLETED' || input.status === 'CANCELLED') {
    return empty('not_applicable', 'Связка закрыта — прогноз не строится')
  }
  const target = nextMilestone(truncateTimeline(timeline, now))
  if (!target) return empty('reached', 'Договор подписан и занятия проведены — ключевые вехи пройдены')

  const { milestone } = target
  const model = input.models.get(milestone.stageNumber)
  const notes: string[] = []
  if (input.status === 'PAUSED') {
    notes.push('Связка на паузе. История пауз в системе не хранится, поэтому модель паузу не учитывает')
  }
  const common = {
    ...base,
    notes,
    milestone: milestoneDto(milestone),
    horizonDays: milestone.horizonDays,
    isMock: timeline.isMock || (model?.metrics.isMock ?? false),
  }

  if (!model) {
    return {
      ...common,
      probability: null,
      source: 'baseline',
      status: 'insufficient_data',
      statusLabel: FORECAST_STATUS_LABELS.insufficient_data,
      summary: 'Модель ещё не обучалась — оценки нет',
      explanation: [],
      modelVersion: null,
      trainedAt: null,
    }
  }

  const medians = storedStageMedians(model.featureStats.stageMedians)
  const features = currentFeatures(timeline, input.peers, now, medians)
  if (!features) {
    return { ...empty('not_applicable', 'У связки нет текущего этапа — прогноз не строится'), notes }
  }
  const context = {
    milestone,
    quantiles: model.featureStats.features
      ? (Object.fromEntries(
          FEATURE_KEYS.map((key) => [key, model.featureStats.features![key].quantiles]),
        ) as Record<FeatureKey, number[]>)
      : undefined,
    stageMedianDays: medians.medianDays(features.stageNumber),
  }
  const meta = { modelVersion: model.version, trainedAt: model.trainedAt.toISOString() }
  const horizon = countWithNoun(milestone.horizonDays, DAY_FORMS)

  if (model.status === 'published' && model.coefficients && model.featureStats.features) {
    const prediction = predictModel(model.coefficients, model.featureStats.features, features)
    const reasons = staleReasons(model.trainedAt, now, input.drift.get(milestone.stageNumber) ?? null)
    const status: ForecastStatus = reasons.length > 0 ? 'stale' : 'preliminary'
    return {
      ...common,
      ...meta,
      notes: [...notes, ...reasons],
      probability: prediction.probability,
      source: 'model',
      status,
      statusLabel: FORECAST_STATUS_LABELS[status],
      summary: `Вероятность дойти до ${milestone.goal} за ${horizon} — по модели, обученной на истории связок`,
      explanation: explainContributions(prediction.contributions, features, context),
    }
  }

  // Модель не прошла ворота — оценка правилом: частота вехи у связок на том же этапе.
  const probability = predictBaseline(model.featureStats.baseline, features.stageNumber)
  const group = model.featureStats.baseline.byStage[String(features.stageNumber)]
  const status: ForecastStatus = model.status === 'baseline_better' ? 'baseline_better' : 'insufficient_data'
  const ruleText = group
    ? `Из ${group.n} ${plural(group.n, CASE_FORMS_OF)}, когда связка была на этапе ${features.stageNumber}, до ${milestone.goal} за ${horizon} дошли ${group.positives}`
    : `Связок на этапе ${features.stageNumber} в истории нет — взята общая частота по всем этапам`
  return {
    ...common,
    ...meta,
    probability,
    source: 'baseline',
    status,
    statusLabel: FORECAST_STATUS_LABELS[status],
    summary:
      probability === null
        ? 'Истории пока нет — оценки нет'
        : status === 'baseline_better'
          ? `Оценка по правилу: модель не оказалась точнее частоты по этапу`
          : `Оценка по правилу: для модели пока мало данных`,
    explanation:
      probability === null
        ? []
        : [
            {
              feature: 'stageNumber',
              title: FEATURE_TITLES.stageNumber,
              value: features.stageNumber,
              contribution: null,
              direction: 'info',
              text: ruleText,
            },
            {
              feature: 'stageNumber',
              title: FEATURE_TITLES.stageNumber,
              value: features.stageNumber,
              contribution: null,
              direction: 'info',
              text: describeFeature('stageNumber', features, context),
            },
          ],
  }
}
