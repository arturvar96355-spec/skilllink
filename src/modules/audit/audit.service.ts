import { notFound, validationError } from '@/shared/http/errors'
import { writeAudit } from '@/shared/audit/audit'
import { pageMeta } from '@/shared/http/pagination'
import { assertCan, canSeeInternalNotes, isUniversityVisible } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { PageMeta } from '@/shared/contracts/common'
import type { AuditLogEntryDto, UniversityEventDto } from '@/shared/contracts/audit'
import { toIsoRequired } from '@/shared/utils/date'
import * as repo from './audit.repo'
import {
  applicationEventTitle,
  cooperationEventTitle,
  documentEventTitle,
  stageEventTitle,
} from './audit.rules'
import type { AuditExportQuery, AuditListQuery, UniversityEventsQuery } from './audit.schema'

/**
 * Журнал критичных действий (раздел 15 ТЗ).
 * Доступен только администратору: он показывает, кто и что делал в системе.
 */
export async function listAuditEntries(
  user: CurrentUser,
  query: AuditListQuery,
): Promise<{ data: AuditLogEntryDto[]; meta: PageMeta }> {
  assertCan(user, 'ADMIN')

  const { rows, total } = await repo.findAuditEntries(query)
  // Этап и пункт чек-листа открываются на странице своей связки: находим её
  // одним запросом на страницу журнала, а не по записи.
  const cooperationOf = await repo.findCooperationsOfObjects(
    rows.filter((row) => row.objectType === 'WorkflowStage').map((row) => row.objectId),
    rows.filter((row) => row.objectType === 'Task').map((row) => row.objectId),
  )
  return {
    data: rows.map((row) => ({
      id: row.id,
      action: row.action,
      objectType: row.objectType,
      objectId: row.objectId,
      payload: (row.payload as Record<string, unknown> | null) ?? null,
      user: row.user,
      cooperationId:
        row.objectType === 'WorkflowStage' || row.objectType === 'Task'
          ? (cooperationOf.get(row.objectId) ?? null)
          : null,
      createdAt: toIsoRequired(row.createdAt),
    })),
    meta: pageMeta({ page: query.page, pageSize: query.pageSize }, total),
  }
}

/**
 * Лента событий вуза (раздел 7.3 ТЗ, «Последние события» и вкладка «История»).
 *
 * Собирается из доменных данных, а не из технического журнала: пользователю нужен рассказ
 * о работе с вузом, а не список действий системы. Внутренние комментарии сотрудников
 * представителю вуза не показываются.
 */
export async function universityEvents(
  user: CurrentUser,
  universityId: string,
  query: UniversityEventsQuery,
): Promise<{ events: UniversityEventDto[]; hasMore: boolean }> {
  assertCan(user, 'READ')

  if (!isUniversityVisible(user, universityId)) throw notFound('Вуз не найден')

  const university = await repo.findUniversityRef(universityId)
  if (!university) throw notFound('Вуз не найден')

  const hideInternal = !canSeeInternalNotes(user)
  const sources = await repo.loadUniversityEvents(universityId, query.limit)
  const events: UniversityEventDto[] = []

  for (const row of sources.cooperations) {
    events.push({
      id: `cooperation:${row.id}`,
      kind: 'cooperation.created',
      title: cooperationEventTitle(row.program.name, row.product?.name ?? null),
      details: null,
      cooperationId: row.id,
      programName: row.program.name,
      author: row.responsible,
      occurredAt: toIsoRequired(row.createdAt),
    })
  }

  for (const row of sources.stageHistory) {
    // Результат этапа вуз видит — это итог работы. Комментарий сотрудника — нет.
    const details = hideInternal ? row.stage.result : (row.comment ?? row.stage.result)
    events.push({
      id: `stage:${row.id}`,
      kind: 'stage.status',
      title: stageEventTitle(row.stage.stageNumber, row.stage.title, row.toStatus),
      details,
      cooperationId: row.stage.cooperationId,
      programName: row.stage.cooperation.program.name,
      author: row.changedBy,
      occurredAt: toIsoRequired(row.changedAt),
    })
  }

  for (const row of sources.documentHistory) {
    events.push({
      id: `document:${row.id}`,
      kind: 'document.status',
      title: documentEventTitle(row.document.title, row.document.version, row.toStatus),
      details: hideInternal ? null : row.comment,
      cooperationId: row.document.cooperationId,
      programName: row.document.program?.name ?? null,
      author: row.changedBy,
      occurredAt: toIsoRequired(row.changedAt),
    })
  }

  for (const row of sources.meetings) {
    events.push({
      id: `meeting:${row.id}`,
      kind: 'meeting',
      title: `Встреча: ${row.topic}`,
      details: row.result,
      cooperationId: row.cooperationId,
      programName: row.program?.name ?? null,
      author: row.responsible,
      occurredAt: toIsoRequired(row.date),
    })
  }

  for (const row of sources.applications) {
    events.push({
      id: `application:${row.id}`,
      kind: 'application',
      title: applicationEventTitle(row.quantity, row.program.name),
      details: row.comment,
      cooperationId: null,
      programName: row.program.name,
      author: row.createdBy,
      occurredAt: toIsoRequired(row.submittedAt),
    })
  }

  events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))

  // Точного общего числа тут нет и быть не может: события склеиваются из пяти
  // источников, и посчитать их все значило бы прочитать всю историю вуза.
  // Но сказать «это не всё» — можно, и интерфейсу этого достаточно,
  // чтобы честно предложить «показать ещё», а не делать вид, что показано всё.
  return { events: events.slice(0, query.limit), hasMore: events.length > query.limit }
}

// ─────────────── Выгрузка для внешней системы сбора событий (решение 123) ───────────────

/** BigInt (номер в цепочке журнала) — строкой: в JSON чисел больше 2^53 нет. */
function ndjsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}

export interface AuditExportPage {
  /** Строки NDJSON: одна запись журнала — одна строка, все колонки. */
  body: string
  count: number
  /** id последней записи страницы — курсор следующего запроса; null — записей нет. */
  lastId: string | null
}

/**
 * Страница журнала для внешней системы (SIEM): NDJSON, после `after_id`, не
 * больше `limit` записей. Только администратор. Сам факт выгрузки — запись
 * `audit.export` (курсор, число, последний id) — попадёт в следующую страницу.
 */
export async function exportAuditEntries(user: CurrentUser, query: AuditExportQuery): Promise<AuditExportPage> {
  assertCan(user, 'ADMIN')
  const rows = await repo.findAuditPageAfter(query.after_id ?? null, query.limit)
  if (rows === null) {
    throw validationError('Курсор выгрузки не найден', [
      { field: 'after_id', message: 'Записи с таким id нет — возможно, удалена по сроку хранения. Начните выгрузку заново' },
    ])
  }
  const body = rows.map((row) => JSON.stringify(row, ndjsonReplacer)).join('\n') + (rows.length > 0 ? '\n' : '')
  const lastId = rows.at(-1)?.id ?? null
  await writeAudit({
    userId: user.id,
    action: 'audit.export',
    objectType: 'AuditLog',
    objectId: 'export',
    payload: { afterId: query.after_id ?? null, limit: query.limit, count: rows.length, lastId },
  })
  return { body, count: rows.length, lastId }
}
