import type { StagePhase, StageStatus } from './enums'

export interface StageTaskDto {
  id: string
  title: string
  isRequired: boolean
  isDone: boolean
  doneAt: string | null
  doneBy: UserRefDto | null
  sortOrder: number
}

export interface UserRefDto {
  id: string
  fullName: string
  role: string
}

export interface StageHistoryEntryDto {
  id: string
  fromStatus: StageStatus | null
  toStatus: StageStatus
  comment: string | null
  changedBy: UserRefDto
  changedAt: string
}

export interface WorkflowStageDto {
  id: string
  cooperationId: string
  stageNumber: number
  title: string
  phase: StagePhase
  status: StageStatus
  responsible: UserRefDto | null
  deadline: string | null
  /** Дедлайн прошёл, а этап не закрыт и не отменён. */
  isOverdue: boolean
  /** Дней до дедлайна: отрицательное значение — просрочка. null, если срока нет. */
  daysToDeadline: number | null
  comment: string | null
  result: string | null
  blockingReason: string | null
  startedAt: string | null
  completedAt: string | null
  completedBy: UserRefDto | null
  /** Этап вычисляется системой и вручную не меняется (этап 14). */
  isAutoManaged: boolean
  tasks: StageTaskDto[]
  requiredTasksTotal: number
  requiredTasksDone: number
  updatedAt: string
}

export interface StageWithCooperationDto extends WorkflowStageDto {
  universityName: string
  programName: string
  productName: string | null
}
