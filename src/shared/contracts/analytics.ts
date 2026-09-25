import type { Metric } from './common'
import type { ProgramRatingFactorKey } from './rating'
import type { RecommendationDto } from './recommendation'

/** Показатель дашборда: значение, единица, период, источник, признак демо-данных. */
/**
 * Сравнение показателя с прошлым периодом: что было на его начале и насколько изменилось.
 * Считается по датам в данных (заведение и закрытие связок, сроки и закрытие этапов),
 * а не по сохранённым снимкам.
 */
export interface MetricTrendDto {
  /** Значение на начало периода. */
  previous: number
  /** Изменение: для долей — в процентных пунктах, для счётчиков — в штуках. */
  delta: number
  direction: 'up' | 'down' | 'flat'
  /** С каким моментом сравнили: «за 30 дней». */
  periodLabel: string
}

export interface DashboardMetricDto extends Metric {
  key: string
  title: string
  /**
   * Сравнение с прошлым периодом. Есть у «Активных связей» и «Этапов в срок»;
   * `null` — сравнить не с чем (например, 30 дней назад закрытых этапов ещё не было).
   */
  trend?: MetricTrendDto | null
}

export interface ProblemCooperationDto {
  cooperationId: string
  universityName: string
  /** Краткое название вуза для плотного списка на главной. null — краткого нет. */
  universityShortName: string | null
  programName: string
  reason: string
  /**
   * Этап, на котором связка встала. Ссылка с главной ведёт прямо к нему,
   * а не на верх карточки, где его ещё надо найти среди четырнадцати.
   */
  stageId: string | null
  stageNumber: number | null
  stageTitle: string | null
  daysOverdue: number | null
}

export interface TopProgramDto {
  programId: string
  programName: string
  universityId: string
  universityName: string
  /** Краткое название вуза для плотного списка. null — краткого нет. */
  universityShortName: string | null
  score: number | null
  basis: 'actual' | 'estimate' | 'none'
  factors: Array<{
    key: ProgramRatingFactorKey
    title: string
    value: number | null
    weight: number
    contribution: number | null
  }>
}

export interface SkillMatchSummaryDto {
  /** Доля востребованных навыков, покрытых программами, 0..100. null — нет данных. */
  coveragePercent: number | null
  /** null — рыночных данных за период нет: ноль означал бы «дефицитов нет». */
  coveredSkills: number | null
  demandedSkills: number | null
  criticalGaps: number | null
  period: string
  isMock: boolean
}

/**
 * Связки по статусам — одна разбивка на все места главной (решение 86).
 *
 * Шапка, меню, кольцо и блок «Связки в работе» говорят об `active`,
 * воронка — о `total`; обе суммы складываются из одних и тех же слагаемых,
 * поэтому интерфейс может объяснить любое число через другое.
 */
export interface CooperationCountsDto {
  /** Активные: в работе и черновики (`ACTIVE_COOPERATION_STATUSES`) = `inWork + drafts`. */
  active: number
  /** В статусе «В работе». */
  inWork: number
  /** В статусе «Черновик». */
  drafts: number
  /** На паузе. */
  paused: number
  /** Завершённые. */
  completed: number
  /** Все, кроме отменённых: столько связок в воронке. */
  total: number
}

export interface DashboardOverviewDto {
  metrics: DashboardMetricDto[]
  /** Связки по статусам; `metrics[activeCooperations].value === cooperationCounts.active`. */
  cooperationCounts: CooperationCountsDto
  topPrograms: TopProgramDto[]
  /** Самые давние проблемные этапы — не больше `DASHBOARD_PROBLEM_LIMIT`. */
  problemCooperations: ProblemCooperationDto[]
  /**
   * Сколько проблемных этапов всего, до обрезания списка.
   *
   * Без этого числа главная выдавала бы показанные строки за все: писала
   * «5 связок встали», когда этапов с вышедшим сроком тринадцать.
   */
  problemStageTotal: number
  /**
   * Блок приоритетных действий пользователя (пункт 7.1 ТЗ).
   * Открытые рекомендации с наибольшим приоритетом. Пусто, если генерация ещё не запускалась.
   */
  priorityActions: RecommendationDto[]
  skillMatch: SkillMatchSummaryDto
  generatedAt: string
  /** Хотя бы часть данных демонстрационная — фронт обязан это показать. */
  containsMockData: boolean
}
