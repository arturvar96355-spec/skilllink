import type { AssignmentDueState } from '@/shared/contracts/assignment'
import type { AssignmentStatus } from '@/shared/contracts/enums'
import { moscowIsoDate } from '@/shared/utils/date'

/**
 * Правила поручений (решение 207) — чистые функции без базы: срок, просрочка,
 * кто что может менять, кому слать уведомление. Одна база подсчёта для списка,
 * колокольчика и столбца «Поручения» на экране «Команда».
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** Сегодняшняя московская дата `ГГГГ-ММ-ДД` — от неё считаются все сроки поручений. */
export function todayIso(now: Date): string {
  return moscowIsoDate(now)
}

/** Срок из базы (`date` приходит полночью UTC) — строкой `ГГГГ-ММ-ДД`. */
export function dueDateIso(dueAt: Date): string {
  return dueAt.toISOString().slice(0, 10)
}

/** Строка `ГГГГ-ММ-ДД` — значение для столбца `date` (полночь UTC той же даты). */
export function dueDateValue(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`)
}

/** Корректная календарная дата `ГГГГ-ММ-ДД`: 2026-02-30 — нет. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = dueDateValue(value)
  return !Number.isNaN(date.getTime()) && dueDateIso(date) === value
}

/** Дней между двумя датами `ГГГГ-ММ-ДД` (`to − from`). */
export function daysBetweenIso(from: string, to: string): number {
  return Math.round((dueDateValue(to).getTime() - dueDateValue(from).getTime()) / DAY_MS)
}

/** Открытое поручение — «Новое» или «В работе». */
export function isOpen(status: AssignmentStatus): boolean {
  return status !== 'DONE'
}

/** Просрочено: не сделано, а срок раньше сегодняшней московской даты. День срока — ещё не просрочка. */
export function isAssignmentOverdue(dueDate: string, status: AssignmentStatus, today: string): boolean {
  return isOpen(status) && dueDate < today
}

/** Где срок относительно сегодня — для подписи в строке и цвета полоски. */
export function dueState(dueDate: string, status: AssignmentStatus, today: string): AssignmentDueState {
  if (!isOpen(status)) return 'done'
  const days = daysBetweenIso(today, dueDate)
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return 'later'
}

/** На сколько дней просрочено; `null`, если не просрочено. */
export function daysOverdue(dueDate: string, status: AssignmentStatus, today: string): number | null {
  return isAssignmentOverdue(dueDate, status, today) ? daysBetweenIso(dueDate, today) : null
}

/** Срок в прошлом не принимается: поручение «на вчера» было бы просрочено с рождения. Сегодня — можно. */
export function isDueDateInPast(dueDate: string, today: string): boolean {
  return dueDate < today
}

/** Когда отмечено «Сделано»: ставится при переходе в DONE, снимается при возврате в работу. */
export function nextDoneAt(
  previous: { status: AssignmentStatus; doneAt: Date | null },
  status: AssignmentStatus,
  now: Date,
): Date | null {
  if (status !== 'DONE') return null
  return previous.status === 'DONE' ? previous.doneAt : now
}

/** Поля, которые меняет только автор; исполнителю из них не доступно ни одно. */
export const AUTHOR_ONLY_FIELDS = ['assigneeId', 'text', 'universityId', 'cooperationId', 'dueDate', 'priority'] as const

export interface AssignmentActor {
  id: string
  isReviewer?: boolean
}

export interface AssignmentParties {
  assigneeId: string
  authorId: string
}

/** Автор меняет всё; эксперту хакатона изменения закрыты (решение 147). */
export function canEditAssignment(user: AssignmentActor, row: AssignmentParties): boolean {
  return !user.isReviewer && row.authorId === user.id
}

/** Статус меняют исполнитель и автор; эксперт — нет. */
export function canChangeAssignmentStatus(user: AssignmentActor, row: AssignmentParties): boolean {
  return !user.isReviewer && (row.assigneeId === user.id || row.authorId === user.id)
}

/**
 * Слать ли уведомление исполнителю: он новый (создание или смена исполнителя)
 * и поручил не он сам себе. Себя уведомлять незачем, как и при назначении ответственным.
 */
export function shouldNotifyAssignee(change: {
  assigneeId: string
  previousAssigneeId: string | null
  actorId: string
}): boolean {
  return change.assigneeId !== change.previousAssigneeId && change.assigneeId !== change.actorId
}
