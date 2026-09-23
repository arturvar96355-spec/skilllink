import type { Metric } from './common'
import type { ProgramRatingFactorKey } from './rating'
import type { RecommendationDto } from './recommendation'

/** Показатель дашборда: значение, единица, период, источник, признак демо-данных. */
export interface DashboardMetricDto extends Metric {
  key: string
  title: string
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

export interface DashboardOverviewDto {
  metrics: DashboardMetricDto[]
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
