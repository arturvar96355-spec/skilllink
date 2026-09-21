import { notFound } from '@/shared/http/errors'
import { pageMeta } from '@/shared/http/pagination'
import { prisma } from '@/shared/db/prisma'
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
import type { AuditListQuery, UniversityEventsQuery } from './audit.schema'

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
  return {
    data: rows.map((row) => ({
      id: row.id,
      action: row.action,
      objectType: row.objectType,
      objectId: row.objectId,
      payload: (row.payload as Record<string, unknown> | null) ?? null,
      user: row.user,
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
 * представителю вуза не показываются (решение 9).
 */
export async function universityEvents(
  user: CurrentUser,
  universityId: string,
  query: UniversityEventsQuery,
): Promise<UniversityEventDto[]> {
  assertCan(user, 'READ')

  if (!isUniversityVisible(user, universityId)) throw notFound('Вуз не найден')

  const university = await prisma.university.findUnique({
    where: { id: universityId },
    select: { id: true },
  })
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
  return events.slice(0, query.limit)
}
