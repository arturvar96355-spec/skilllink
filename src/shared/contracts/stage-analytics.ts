import type { CooperationStatus } from './enums'

/**
 * Аналитика этапов на статистике (решение 120): длительность этапов по
 * Каплану–Мейеру, порог застоя, воронка, когорты, «Система заметила», пульс.
 * Формулы — docs/ANALYTICS_MODEL.md.
 */

/** Интервал (95%) для дня квантиля. null — полоса до уровня не дошла: «больше наблюдаемого». */
export interface DayIntervalDto {
  low: number | null
  high: number | null
}

/** Точка кривой «доля прошедших этап к дню t» с 95% интервалом. */
export interface DurationCurvePointDto {
  day: number
  /** Доля 0..1. */
  F: number
  lo: number
  hi: number
}

/** Порог застоя этапа: по данным (p90) или ручной `stalledDays`. */
export interface StalledThresholdDto {
  days: number
  source: 'km' | 'manual'
  ci: DayIntervalDto | null
  n: number
  events: number
  /** Почему ручной. null — порог по данным. */
  reason: 'disabled' | 'insufficient_data' | 'quantile_not_reached' | 'not_computed' | null
}

export interface StageDurationDto {
  stageNumber: number
  title: string
  /** `insufficient_data` — наблюдений или переходов меньше минимума: оценке не верить. */
  status: 'ok' | 'insufficient_data'
  /** Связок, входивших в этап. */
  n: number
  /** Из них перешли дальше (события). */
  events: number
  /** Ещё на этапе, на паузе или отменены на нём (цензура). */
  censored: number
  /** Медиана, дней: «нормальное время этапа». null — половина ещё не прошла. */
  median: number | null
  /** p90, дней: порог «застряло». null — 90% ещё не прошли. */
  p90: number | null
  ci: { median: DayIntervalDto; p90: DayIntervalDto }
  curve: DurationCurvePointDto[]
  /** Какой порог застоя сейчас берёт правило рекомендаций для этого этапа. */
  threshold: StalledThresholdDto
}

export interface StageDurationsDto {
  stages: StageDurationDto[]
  /** Минимумы, при которых оценке верят (STALLED_THRESHOLD). */
  minObservations: number
  minEvents: number
  /** Квантиль порога застоя: 0,9. */
  quantile: number
  /** Флаг «порог застоя по данным». */
  fromData: boolean
  generatedAt: string
  isMock: boolean
  source: string
}

export interface StalledPreviewItemDto {
  cooperationId: string
  title: string
  stageNumber: number
  idleDays: number
  href: string
}

export interface StalledPreviewStageDto {
  stageNumber: number
  title: string
  /** Открытых связок, у которых этот этап текущий. */
  open: number
  current: StalledThresholdDto
  proposedDays: number
  /** Застрявших сейчас (по текущему порогу) и станет при предложенном. */
  before: number
  after: number
  becomeStalled: StalledPreviewItemDto[]
  stopBeingStalled: StalledPreviewItemDto[]
}

export interface StalledPreviewDto {
  proposedDays: number
  before: number
  after: number
  stages: StalledPreviewStageDto[]
  /** Связки, по которым рекомендации о застое нет, потому что есть о просрочке. */
  suppressedByOverdue: number
  isMock: boolean
}

export interface FunnelDroppedDto {
  cooperationId: string
  title: string
  status: CooperationStatus
  href: string
}

export interface FunnelStepDto {
  key: string
  title: string
  /** Этап, с которого начинается шаг (14 — закрыты этапы 1–13). */
  fromStage: number
  reached: number
  conversionFromPrevious: number | null
  conversionFromStart: number | null
  medianDaysFromPrevious: number | null
  inProgress: number
  droppedCount: number
  dropped: FunnelDroppedDto[]
}

export interface FunnelGroupDto {
  key: string
  label: string
  total: number
  steps: Array<{ key: string; reached: number; conversionFromStart: number | null }>
}

export type FunnelGroupBy = 'region' | 'university' | 'product' | 'programLevel' | 'city'

export interface FunnelDto {
  milestones: boolean
  groupBy: FunnelGroupBy | null
  from: string | null
  to: string | null
  total: number
  steps: FunnelStepDto[]
  groups: FunnelGroupDto[]
  isMock: boolean
}

export interface CohortCellDto {
  offset: number
  reached: number
  share: number | null
  complete: boolean
}

export interface CohortDto {
  cohort: string
  size: number
  cells: CohortCellDto[]
}

export interface CohortsDto {
  milestone: { key: string; title: string; fromStage: number }
  cohorts: CohortDto[]
  isMock: boolean
}

export type InsightSeverity = 'critical' | 'warning' | 'info'

/** Разрез, объясняющий изменение: вуз и его вклад. */
export interface InsightSliceDto {
  key: string
  label: string
  /** Вклад в изменение, событий в день (сумма по всем разрезам = общему изменению). */
  delta: number
  /** Доля общего изменения; null — изменения нет. */
  share: number | null
}

export type InsightFactValue = number | string | boolean | null | InsightSliceDto[]

export interface InsightDto {
  /** Постоянный код шаблона: `anomaly.stage_transitions.down`, `stages.insufficient_data`. */
  code: string
  severity: InsightSeverity
  title: string
  detail: string
  facts: Record<string, InsightFactValue>
  /** Куда вести: страница интерфейса. null — некуда. */
  link: string | null
}

export type PulseSectionKey = 'attention' | 'today' | 'decide' | 'wins'

export interface PulseItemDto {
  /** Правило пульса: `stage.overdue`, `cooperation.stalled`, `meeting.no-result`… */
  kind: string
  /** Подзаголовок внутри раздела: «Просрочено», «Застряло дольше обычного». */
  group: string
  severity: InsightSeverity
  text: string
  href: string | null
  cooperationId: string | null
}

export interface PulseSectionDto {
  key: PulseSectionKey
  title: string
  /** Сколько всего; `items` — не больше потолка раздела. */
  total: number
  items: PulseItemDto[]
}

export interface PulseDto {
  generatedAt: string
  /** Сколько правил проверено — показывается и при пустом пульсе. */
  checkedRules: number
  /** Нет ничего во «Внимании», «Сегодня» и «Решить». */
  isCalm: boolean
  /** Фраза для пустого пульса: «Всё спокойно…». null — пульс не пуст. */
  calmText: string | null
  sections: PulseSectionDto[]
}
