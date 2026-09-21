import type { CooperationStatus, StagePhase, StageStatus } from './enums'
import type { UserRefDto, WorkflowStageDto } from './workflow'

/** Короткая сводка текущего этапа для списков. */
export interface CurrentStageDto {
  id: string
  stageNumber: number
  title: string
  phase: StagePhase
  status: StageStatus
  deadline: string | null
  isOverdue: boolean
  /** Срок ещё не вышел, но выйдет со дня на день. С `isOverdue` не пересекается. */
  isDueSoon: boolean
}

export interface CooperationProgressDto {
  /** Доля завершённых этапов от всех, 0..100. Отменённые считаются закрытыми. */
  percent: number
  completedStages: number
  cancelledStages: number
  totalStages: number
  overdueStages: number
  /** Этапы, у которых срок вот-вот выйдет. В `overdueStages` не входят. */
  dueSoonStages: number
  blockedStages: number
}

export interface CooperationListItemDto {
  id: string
  universityId: string
  universityName: string
  programId: string
  programName: string
  productId: string | null
  productName: string | null
  status: CooperationStatus
  responsible: UserRefDto
  currentStage: CurrentStageDto | null
  progress: CooperationProgressDto
  targetDate: string | null
  classesStartAt: string | null
  /** Дней до контрольного события. Отрицательное — срок прошёл. */
  daysToTarget: number | null
  isMock: boolean
  updatedAt: string
}

export interface CooperationDto extends CooperationListItemDto {
  goal: string | null
  notes: string | null
  firstContactAt: string | null
  startedAt: string | null
  closedAt: string | null
  createdAt: string
  stages: WorkflowStageDto[]
}
