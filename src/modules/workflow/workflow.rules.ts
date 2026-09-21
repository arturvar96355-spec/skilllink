import { invalidTransition, validationError } from '@/shared/http/errors'
import { CONTROL_STAGE_NUMBER } from '@/shared/config/workflow.config'
import type { StageStatus, UserRole } from '@/shared/contracts/enums'

/**
 * Таблица переходов (решение 3 в CLAUDE.md).
 * Любой переход, которого здесь нет, — ошибка INVALID_TRANSITION.
 */
export const ALLOWED_TRANSITIONS: Record<StageStatus, readonly StageStatus[]> = {
  NOT_STARTED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'BLOCKED', 'CANCELLED'],
  BLOCKED: ['IN_PROGRESS', 'CANCELLED'],
  // Переоткрытие завершённого этапа — только с комментарием.
  COMPLETED: ['IN_PROGRESS'],
  // Отменённый этап конечный: переоткрыть может только администратор.
  CANCELLED: ['IN_PROGRESS'],
}

export const STATUS_LABELS: Record<StageStatus, string> = {
  NOT_STARTED: 'Не начат',
  IN_PROGRESS: 'В работе',
  BLOCKED: 'Заблокирован',
  COMPLETED: 'Завершён',
  CANCELLED: 'Отменён',
}

export interface StageState {
  stageNumber: number
  status: StageStatus
  result: string | null
  requiredTasksTotal: number
  requiredTasksDone: number
}

export interface TransitionRequest {
  toStatus: StageStatus
  comment?: string | null
  result?: string | null
  blockingReason?: string | null
}

function isFilled(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/** Этап 14 вычисляется автоматически и руками не меняется (решение 2). */
export function isAutoManaged(stageNumber: number): boolean {
  return stageNumber === CONTROL_STAGE_NUMBER
}

/**
 * Проверяет переход целиком: допустимость по таблице, условия завершения,
 * блокировки, отмены и переоткрытия. Бросает ошибку с понятным русским текстом.
 */
export function assertTransition(
  stage: StageState,
  request: TransitionRequest,
  role: UserRole,
): void {
  if (isAutoManaged(stage.stageNumber)) {
    throw invalidTransition(
      'Этап «Контроль выполнения всех этапов» вычисляется автоматически и вручную не изменяется',
      { stageNumber: stage.stageNumber },
    )
  }

  const from = stage.status
  const to = request.toStatus

  if (from === to) {
    throw invalidTransition(`Этап уже находится в статусе «${STATUS_LABELS[to]}»`, {
      from,
      to,
    })
  }

  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw invalidTransition(
      `Недопустимый переход: «${STATUS_LABELS[from]}» → «${STATUS_LABELS[to]}»`,
      { from, to, allowed: ALLOWED_TRANSITIONS[from] },
    )
  }

  // Переоткрытие отменённого этапа — право администратора.
  if (from === 'CANCELLED' && role !== 'ADMIN') {
    throw invalidTransition(
      'Отменённый этап может переоткрыть только администратор',
      { from, to },
    )
  }

  // Любое переоткрытие требует объяснения: оно попадёт в историю.
  if ((from === 'COMPLETED' || from === 'CANCELLED') && !isFilled(request.comment)) {
    throw validationError('Для переоткрытия этапа нужен комментарий с причиной', [
      { field: 'comment', message: 'Укажите причину переоткрытия' },
    ])
  }

  if (to === 'BLOCKED' && !isFilled(request.blockingReason)) {
    throw validationError('Для блокировки этапа нужна причина', [
      { field: 'blockingReason', message: 'Укажите причину блокировки' },
    ])
  }

  if (to === 'CANCELLED' && !isFilled(request.comment)) {
    throw validationError('Для отмены этапа нужен комментарий с основанием', [
      { field: 'comment', message: 'Укажите основание отмены, например «не требуется»' },
    ])
  }

  if (to === 'COMPLETED') {
    const result = isFilled(request.result) ? request.result : stage.result
    if (!isFilled(result)) {
      throw validationError('Нельзя завершить этап без результата', [
        { field: 'result', message: 'Опишите результат этапа' },
      ])
    }

    if (stage.requiredTasksDone < stage.requiredTasksTotal) {
      throw invalidTransition(
        `Не закрыты обязательные пункты чек-листа: ${stage.requiredTasksDone} из ${stage.requiredTasksTotal}`,
        {
          requiredTasksDone: stage.requiredTasksDone,
          requiredTasksTotal: stage.requiredTasksTotal,
        },
      )
    }
  }
}

/**
 * Статус контрольного этапа 14 по состоянию этапов 1–13 (решение 2).
 * COMPLETED — когда все закрыты или отменены.
 */
export function computeControlStatus(others: readonly StageStatus[]): StageStatus {
  if (others.length === 0) return 'NOT_STARTED'
  const allClosed = others.every((status) => status === 'COMPLETED' || status === 'CANCELLED')
  if (allClosed) return 'COMPLETED'
  const anyStarted = others.some((status) => status !== 'NOT_STARTED')
  return anyStarted ? 'IN_PROGRESS' : 'NOT_STARTED'
}

/**
 * Текущий этап — первый по номеру, который не завершён и не отменён (решение 5).
 * Порядок этапов не жёсткий: часть из них идёт параллельно.
 */
export function findCurrentStage<T extends { stageNumber: number; status: StageStatus }>(
  stages: readonly T[],
): T | null {
  const open = stages
    .filter((stage) => stage.status !== 'COMPLETED' && stage.status !== 'CANCELLED')
    .filter((stage) => !isAutoManaged(stage.stageNumber))
    .sort((a, b) => a.stageNumber - b.stageNumber)
  return open[0] ?? null
}

/** Процент выполнения связки: закрытыми считаются и завершённые, и отменённые этапы. */
export function computeProgressPercent(statuses: readonly StageStatus[]): number {
  if (statuses.length === 0) return 0
  const closed = statuses.filter(
    (status) => status === 'COMPLETED' || status === 'CANCELLED',
  ).length
  return Math.round((closed / statuses.length) * 100)
}

/** Этап просрочен, если срок прошёл, а этап не закрыт и не отменён. */
export function isOverdue(
  deadline: Date | null,
  status: StageStatus,
  now: Date = new Date(),
): boolean {
  if (!deadline) return false
  if (status === 'COMPLETED' || status === 'CANCELLED') return false
  return deadline.getTime() < now.getTime()
}
