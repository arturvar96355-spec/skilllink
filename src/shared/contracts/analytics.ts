import type { Metric } from './common'
import type { ProgramRatingFactorKey } from './rating'
import type { RecommendationDto } from './recommendation'

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

/** Показатель дашборда: значение, единица, период, источник, признак демо-данных. */
export interface DashboardMetricDto extends Metric {
  key: string
  title: string
  /**
   * Сравнение с прошлым периодом. Есть у «Активных связей» и «Этапов в срок»;
   * `null` — сравнить не с чем (например, 30 дней назад закрытых этапов ещё не было).
   */
  trend?: MetricTrendDto | null
  /**
   * Знаменатель доли, готовой строкой (решение 180, п. 2): «из 92 этапов» —
   * у «Этапов в срок» это число завершённых этапов, сколько раз доля
   * посчитана. У показателей, которые не доля, поля нет.
   */
  denominatorLabel?: string | null
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
  /**
   * Серьёзность (решение 206): `overdue-long` — срок вышел больше
   * `problemGroups.longOverdueDays` дней назад, `overdue` — позже, `blocked` —
   * этап заблокирован (срок тогда не важен). По ней строка встаёт в свою группу.
   */
  severity: ProblemSeverity
  /** Срок этапа, ISO 8601. null — срок не задан (бывает только у заблокированного). */
  deadline: string | null
  /** Причина блокировки как её записали, без приставки «Этап заблокирован:». null — этап не заблокирован. */
  blockingReason: string | null
  /** Ответственный за этап (не за связку) — тот же, что на экране «Команда». null — не назначен. */
  responsible: { id: string; fullName: string } | null
}

/** Серьёзность проблемного этапа — группа в блоке «Требует внимания» (решение 206). */
export type ProblemSeverity = 'overdue-long' | 'overdue' | 'blocked'

/**
 * Сколько проблемных этапов в каждой группе — по **всем** этапам, а не по
 * показанным `problemCooperations`: `overdueLong + overdue + blocked === problemStageTotal`.
 */
export interface ProblemGroupsDto {
  overdueLong: number
  overdue: number
  blocked: number
  /** Порог «давней» просрочки в днях (`PROBLEM_LONG_OVERDUE_DAYS`, TEMP) — для подписи группы. */
  longOverdueDays: number
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
  /** Разбивка `problemStageTotal` по серьёзности (решение 206). */
  problemGroups: ProblemGroupsDto
  /**
   * Блок приоритетных действий пользователя (пункт 7.1 ТЗ).
   * Открытые рекомендации: по приоритету, внутри приоритета — по баллу (решение 206);
   * отложенные защитой от перегрузки (`isDeferred`) сюда не попадают.
   * Пусто, если генерация ещё не запускалась.
   */
  priorityActions: RecommendationDto[]
  /**
   * Сколько всего открытых рекомендаций, включая `stage.overdue` — который
   * решением 180 не входит в `priorityActions` (та же просрочка уже названа
   * в блоке «Требует внимания»). Пустой `priorityActions` при ненулевом этом
   * числе — не «рекомендаций нет», а «остались только просрочки этапов»:
   * фронт выбирает текст пустого состояния по этому числу (решение 187).
   */
  openRecommendationsTotal: number
  skillMatch: SkillMatchSummaryDto
  generatedAt: string
  /** Хотя бы часть данных демонстрационная — фронт обязан это показать. */
  containsMockData: boolean
}
