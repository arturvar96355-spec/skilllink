import { assertCan, assertReviewerAllowed, can, canSeeTeam } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import { writeAudit } from '@/shared/audit/audit'
import { forbidden, notFound, validationError } from '@/shared/http/errors'
import { pageMeta } from '@/shared/http/pagination'
import type { PageMeta } from '@/shared/http/response'
import type { AssignmentDto } from '@/shared/contracts/assignment'
import type { AssignmentStatus } from '@/shared/contracts/enums'
import { publicBaseUrl } from '@/shared/config/public-url'
import { log } from '@/shared/log/logger'
import { sendToUser } from '@/modules/notify-channels/notify-channels.service'
import * as repo from './assignments.repo'
import type { AssignmentRow } from './assignments.repo'
import {
  AUTHOR_ONLY_FIELDS,
  canChangeAssignmentStatus,
  canEditAssignment,
  daysOverdue,
  dueDateIso,
  dueDateValue,
  dueState,
  isDueDateInPast,
  nextDoneAt,
  shouldNotifyAssignee,
  todayIso,
} from './assignments.rules'
import { buildAssignmentMessage } from './assignments.notice'
import type { AssignmentListQuery, CreateAssignmentInput, UpdateAssignmentInput } from './assignments.schema'

/**
 * Поручения сотрудникам (решение 207).
 *
 * Права — здесь, а не в маршруте:
 * - дать поручение — `ASSIGN_TASKS` (ADMIN, HEAD); эксперт хакатона — 403, как на все изменения;
 * - видеть все — у кого есть `ASSIGN_TASKS` или экран «Команда» (ADMIN, HEAD, эксперт);
 *   остальные сотрудники — только свои; представителю вуза раздел закрыт;
 * - менять: автор — всё, исполнитель — только статус (`AUTHOR_ONLY_FIELDS`).
 * Каждое изменение — запись в журнал действий. Уведомление исполнителю — после записи,
 * в фоне: сбой мессенджера поручение не откатывает.
 */

function assertStaff(user: CurrentUser): void {
  if (user.role === 'UNIVERSITY_REP') throw forbidden('Поручения — раздел сотрудников ИТ-Школы')
  assertCan(user, 'READ')
}

/** Видит поручения всех сотрудников: руководитель, администратор, эксперт (только чтение). */
export function canSeeAllAssignments(user: CurrentUser): boolean {
  return can(user, 'ASSIGN_TASKS') || canSeeTeam(user)
}

export function toDto(row: AssignmentRow, user: CurrentUser, now: Date): AssignmentDto {
  const today = todayIso(now)
  const due = dueDateIso(row.dueAt)
  const university = row.university ?? row.cooperation?.university ?? null
  return {
    id: row.id,
    text: row.text,
    priority: row.priority,
    status: row.status,
    dueDate: due,
    dueState: dueState(due, row.status, today),
    daysOverdue: daysOverdue(due, row.status, today),
    assignee: { id: row.assignee.id, fullName: row.assignee.fullName },
    author: { id: row.author.id, fullName: row.author.fullName },
    university: university ? { id: university.id, name: university.name, shortName: university.shortName } : null,
    cooperation: row.cooperation ? { id: row.cooperation.id, programName: row.cooperation.program.name } : null,
    doneAt: row.doneAt ? row.doneAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    isMock: row.isMock,
    canEdit: canEditAssignment(user, row),
    canChangeStatus: canChangeAssignmentStatus(user, row),
  }
}

export async function list(
  user: CurrentUser,
  query: AssignmentListQuery,
  now: Date = new Date(),
): Promise<{ data: AssignmentDto[]; meta: PageMeta }> {
  assertStaff(user)
  let assigneeId = query.assigneeId
  if (!canSeeAllAssignments(user)) {
    if (assigneeId !== undefined && assigneeId !== user.id) {
      throw forbidden('Чужие поручения видят руководитель и администратор')
    }
    assigneeId = user.id
  }
  const { rows, total } = await repo.findMany(
    {
      assigneeId,
      statuses: query.status,
      overdueBefore: query.overdue ? dueDateValue(todayIso(now)) : undefined,
    },
    query,
  )
  return { data: rows.map((row) => toDto(row, user, now)), meta: pageMeta(query, total) }
}

/**
 * Вуз и связка поручения: при заданной связке вуз — её вуз (прислали другой — ошибка),
 * без связки — вуз, если он есть. Возвращает, что записать.
 */
async function resolvePlace(
  universityId: string | null | undefined,
  cooperationId: string | null | undefined,
): Promise<{ universityId: string | null; cooperationId: string | null }> {
  if (cooperationId) {
    const cooperation = await repo.findCooperationUniversity(cooperationId)
    if (!cooperation) {
      throw validationError('Связка не найдена', [{ field: 'cooperationId', message: 'Связка не найдена' }])
    }
    if (universityId && universityId !== cooperation.universityId) {
      throw validationError('Связка относится к другому вузу', [
        { field: 'cooperationId', message: 'Связка относится к другому вузу' },
      ])
    }
    return { universityId: cooperation.universityId, cooperationId: cooperation.id }
  }
  if (universityId) {
    if (!(await repo.universityExists(universityId))) {
      throw validationError('Вуз не найден', [{ field: 'universityId', message: 'Вуз не найден' }])
    }
    return { universityId, cooperationId: null }
  }
  return { universityId: null, cooperationId: null }
}

function assertDueDate(dueDate: string, now: Date): void {
  if (isDueDateInPast(dueDate, todayIso(now))) {
    throw validationError('Срок не может быть в прошлом', [
      { field: 'dueDate', message: 'Срок не может быть в прошлом — самое раннее сегодня' },
    ])
  }
}

async function assertAssignable(assigneeId: string): Promise<void> {
  if (!(await repo.findAssignableUser(assigneeId))) {
    throw validationError('Поручить можно только действующему сотруднику ИТ-Школы', [
      { field: 'assigneeId', message: 'Не сотрудник ИТ-Школы, заблокирован или учётная запись эксперта' },
    ])
  }
}

export async function create(user: CurrentUser, input: CreateAssignmentInput, now: Date = new Date()): Promise<AssignmentDto> {
  assertCan(user, 'ASSIGN_TASKS')
  assertDueDate(input.dueDate, now)
  await assertAssignable(input.assigneeId)
  const place = await resolvePlace(input.universityId, input.cooperationId)

  const row = await repo.create({
    assigneeId: input.assigneeId,
    authorId: user.id,
    text: input.text,
    universityId: place.universityId,
    cooperationId: place.cooperationId,
    dueAt: dueDateValue(input.dueDate),
    priority: input.priority,
  })

  await writeAudit({
    userId: user.id,
    action: 'assignment.create',
    objectType: 'Assignment',
    objectId: row.id,
    // Текст не пишется: он свободный, в нём бывают ФИО контактов вуза.
    payload: { assigneeId: row.assigneeId, priority: row.priority, dueDate: input.dueDate },
  })

  notifyAssignee(row, { previousAssigneeId: null, actorId: user.id })
  return toDto(row, user, now)
}

export async function update(
  user: CurrentUser,
  id: string,
  input: UpdateAssignmentInput,
  now: Date = new Date(),
): Promise<AssignmentDto> {
  assertStaff(user)
  const existing = await repo.findById(id)
  // Чужое поручение для сотрудника, который видит только свои, — «не найдено», а не 403:
  // существование записи не раскрывается.
  if (!existing || (!canSeeAllAssignments(user) && existing.assigneeId !== user.id)) {
    throw notFound('Поручение не найдено')
  }
  // Эксперт хакатона — 403 на любое изменение (решение 147), даже если формально исполнитель.
  assertReviewerAllowed(user)

  const authorFields = AUTHOR_ONLY_FIELDS.filter((field) => input[field] !== undefined)
  if (authorFields.length > 0) {
    if (existing.authorId !== user.id) {
      throw forbidden('Текст, срок, важность и исполнителя меняет автор поручения; исполнитель — только статус')
    }
    assertCan(user, 'ASSIGN_TASKS')
  } else if (!canChangeAssignmentStatus(user, existing)) {
    throw forbidden('Статус меняют исполнитель и автор поручения')
  }

  const existingDue = dueDateIso(existing.dueAt)
  if (input.dueDate !== undefined && input.dueDate !== existingDue) assertDueDate(input.dueDate, now)
  if (input.assigneeId !== undefined && input.assigneeId !== existing.assigneeId) await assertAssignable(input.assigneeId)
  const placeChanged = input.universityId !== undefined || input.cooperationId !== undefined
  const place = placeChanged
    ? await resolvePlace(
        input.universityId !== undefined ? input.universityId : existing.universityId,
        input.cooperationId !== undefined ? input.cooperationId : input.universityId !== undefined ? null : existing.cooperationId,
      )
    : null

  const status: AssignmentStatus = input.status ?? existing.status
  const row = await repo.update(id, {
    ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
    ...(input.text !== undefined ? { text: input.text } : {}),
    ...(input.dueDate !== undefined ? { dueAt: dueDateValue(input.dueDate) } : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    ...(place ? place : {}),
    ...(input.status !== undefined ? { status, doneAt: nextDoneAt(existing, status, now) } : {}),
  })

  const statusChanged = input.status !== undefined && input.status !== existing.status
  if (authorFields.length > 0) {
    await writeAudit({
      userId: user.id,
      action: 'assignment.update',
      objectType: 'Assignment',
      objectId: id,
      payload: {
        fields: [...authorFields, ...(statusChanged ? ['status'] : [])],
        ...(input.assigneeId !== undefined && input.assigneeId !== existing.assigneeId
          ? { assigneeId: input.assigneeId, previousAssigneeId: existing.assigneeId }
          : {}),
        ...(statusChanged ? { from: existing.status, to: status } : {}),
      },
    })
  } else if (statusChanged) {
    await writeAudit({
      userId: user.id,
      action: 'assignment.status',
      objectType: 'Assignment',
      objectId: id,
      payload: { from: existing.status, to: status },
    })
  }

  notifyAssignee(row, { previousAssigneeId: existing.assigneeId, actorId: user.id })
  return toDto(row, user, now)
}

// ───────────────────── Уведомление исполнителю → мессенджер ─────────────────────

export type AssignmentNoticeOutcome = 'skipped' | 'sent' | 'not-delivered' | 'failed'

/**
 * «Вам новое поручение» новому исполнителю через его канал (`sendToUser`, решение 144).
 * Ничего не подключено — тихо не уходит. Не бросает: поручение уже записано, сбой
 * мессенджера — строка в журнале приложения без текста и ФИО.
 */
export async function sendAssigneeNotice(
  row: AssignmentRow,
  change: { previousAssigneeId: string | null; actorId: string },
): Promise<AssignmentNoticeOutcome> {
  if (!shouldNotifyAssignee({ assigneeId: row.assigneeId, ...change })) return 'skipped'
  try {
    const university = row.university ?? row.cooperation?.university ?? null
    const message = buildAssignmentMessage(
      {
        assignmentId: row.id,
        dueDate: dueDateIso(row.dueAt),
        priority: row.priority,
        universityName: university ? (university.shortName ?? university.name) : null,
      },
      { baseUrl: publicBaseUrl() },
    )
    const result = await sendToUser(row.assigneeId, message)
    log.info('[assignments] уведомление о поручении', { assignmentId: row.id, sent: result.sent, channel: result.channel })
    return result.sent ? 'sent' : 'not-delivered'
  } catch (error) {
    log.warn('[assignments] уведомление о поручении не отправлено', { assignmentId: row.id, err: error })
    return 'failed'
  }
}

/** Ответ POST/PATCH мессенджер не ждёт: отправка в фоне, её ошибка запись не откатывает. */
function notifyAssignee(row: AssignmentRow, change: { previousAssigneeId: string | null; actorId: string }): void {
  if (!shouldNotifyAssignee({ assigneeId: row.assigneeId, ...change })) return
  void sendAssigneeNotice(row, change)
}
