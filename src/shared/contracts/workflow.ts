import type { StagePhase, StageStatus, UserRole } from './enums'

/**
 * Как сотрудник ИТ-Школы может отметить пункт чек-листа (решение 103):
 * - ALLOWED — как обычно;
 * - NOTE_REQUIRED — пункт вуза, представителя у вуза нет: отметка только с пометкой
 *   «чем подтверждено» (`confirmationNote`), снять можно без неё;
 * - UNIVERSITY_ONLY — пункт вуза, у вуза есть действующий представитель: отмечает
 *   и снимает только он в кабинете вуза, сотруднику — 403.
 */
export const STAFF_MARK_RULES = ['ALLOWED', 'NOTE_REQUIRED', 'UNIVERSITY_ONLY'] as const
export type StaffMarkRule = (typeof STAFF_MARK_RULES)[number]

/** Границы пометки «чем подтверждено» — одни для API, фронта и CHECK в базе. */
export const CONFIRMATION_NOTE_MIN = 3
export const CONFIRMATION_NOTE_MAX = 500

export interface StageTaskDto {
  id: string
  title: string
  isRequired: boolean
  isDone: boolean
  doneAt: string | null
  doneBy: UserRefDto | null
  sortOrder: number
  /** Пункт вуза: «Вуз подтвердил получение материалов» (решение 103). */
  isUniversityItem: boolean
  /** Как его может отметить сотрудник. Для обычных пунктов — всегда ALLOWED. */
  staffMarkRule: StaffMarkRule
  /**
   * Чем подтверждено, если пункт вуза отметил сотрудник. null — отметил сам вуз,
   * пункт не отмечен или смотрит представитель вуза (пометка внутренняя, вузу не видна).
   */
  confirmationNote: string | null
}

export interface UserRefDto {
  id: string
  fullName: string
  /** Именно `UserRole`, а не `string`: иначе `USER_ROLE_LABELS[ref.role]` не соберётся. */
  role: UserRole
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
  /** Дедлайн прошёл, а этап в работе или заблокирован. */
  isOverdue: boolean
  /**
   * План сдвинут: дедлайн прошёл, а этап ещё не начат. Это не просрочка —
   * в счётчики проблем не идёт. С `isOverdue` и `isDueSoon` не пересекается.
   */
  isPlanShifted: boolean
  /**
   * Срок ещё не вышел, но выйдет со дня на день. С `isOverdue` не пересекается:
   * этап либо просрочен, либо вот-вот просрочится, либо ни то ни другое.
   */
  isDueSoon: boolean
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
