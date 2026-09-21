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
  programName: string
  reason: string
  stageNumber: number | null
  stageTitle: string | null
  daysOverdue: number | null
}

export interface TopProgramDto {
  programId: string
  programName: string
  universityId: string
  universityName: string
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
  coveredSkills: number
  demandedSkills: number
  criticalGaps: number
  period: string
  isMock: boolean
}

export interface DashboardOverviewDto {
  metrics: DashboardMetricDto[]
  topPrograms: TopProgramDto[]
  problemCooperations: ProblemCooperationDto[]
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
