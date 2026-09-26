import { assertCan, canSeeInternalNotes, isUniversityVisible } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import {
  type TimelineEventDto,
  type TimelineEventType,
  type TimelineMetaDto,
} from '@/shared/contracts/data-quality'
import type { AuditActionCode } from '@/shared/contracts/audit'
import { AUDIT_ACTION_LABELS, RECOMMENDATION_STATUS_LABELS } from '@/shared/contracts/labels'
import type { RecommendationStatus } from '@/shared/contracts/enums'
import { notFound } from '@/shared/http/errors'
import { toIsoRequired } from '@/shared/utils/date'
import {
  applicationEventTitle,
  cooperationEventTitle,
  documentEventTitle,
  stageEventTitle,
} from '@/modules/audit/audit.rules'
import * as repo from './timeline.repo'
import type { TimelineQuery } from './timeline.schema'
import { allowedTimelineTypes, decodeCursor, describeFields, pageOfEvents } from './timeline.rules'


/**
 * Лента 360 вуза (решение 134): смены этапов, встречи, документы, заявки, связки,
 * рекомендации и их статусы, факты по основаниям обработки ПД контактов, правки
 * записи вуза и слияния — одной лентой, новые сверху, с курсором.
 *
 * Представитель вуза видит только свой вуз (чужой — 404, как везде) и только типы,
 * разрешённые его роли; внутренние комментарии сотрудников ему не показываются.
 */
export async function universityTimeline(
  user: CurrentUser,
  universityId: string,
  query: TimelineQuery,
  now: Date = new Date(),
): Promise<{ data: TimelineEventDto[]; meta: TimelineMetaDto }> {
  assertCan(user, 'READ')
  if (!isUniversityVisible(user, universityId)) throw notFound('Вуз не найден')
  if (!(await repo.universityExists(universityId))) throw notFound('Вуз не найден')

  const cursor = query.cursor ? decodeCursor(query.cursor) : null
  const types = allowedTimelineTypes(user, query.types)
  const sources = await repo.loadTimeline(universityId, types, { before: cursor?.at ?? null, take: query.limit + 1 }, now)
  const events = toEvents(sources, !canSeeInternalNotes(user))
  const page = pageOfEvents(events, cursor, query.limit)
  return { data: page.items, meta: { limit: query.limit, nextCursor: page.nextCursor, hasMore: page.hasMore, types } }
}

function event(
  type: TimelineEventType,
  id: string,
  fields: Omit<TimelineEventDto, 'id' | 'type' | 'occurredAt'> & { occurredAt: Date },
): TimelineEventDto {
  return { ...fields, id: `${type}:${id}`, type, occurredAt: toIsoRequired(fields.occurredAt) }
}

const cooperationHref = (id: string | null) => (id ? `/cooperations/${id}` : null)

/** Строки источников → события ленты. Отдельно от запроса — проверяется тестами. */
export function toEvents(sources: repo.TimelineSources, hideInternal: boolean): TimelineEventDto[] {
  const events: TimelineEventDto[] = []

  for (const row of sources.cooperations) {
    events.push(event('cooperation', row.id, {
      kind: 'cooperation.created',
      title: cooperationEventTitle(row.program.name, row.product?.name ?? null),
      details: null,
      cooperationId: row.id,
      programName: row.program.name,
      href: cooperationHref(row.id),
      author: row.responsible,
      occurredAt: row.createdAt,
    }))
  }

  for (const row of sources.stages) {
    events.push(event('stage', row.id, {
      kind: 'stage.status',
      title: stageEventTitle(row.stage.stageNumber, row.stage.title, row.toStatus),
      // Результат этапа вуз видит — это итог работы. Комментарий сотрудника — нет.
      details: hideInternal ? row.stage.result : (row.comment ?? row.stage.result),
      cooperationId: row.stage.cooperationId,
      programName: row.stage.cooperation.program.name,
      href: cooperationHref(row.stage.cooperationId),
      author: row.changedBy,
      occurredAt: row.changedAt,
    }))
  }

  for (const row of sources.meetings) {
    events.push(event('meeting', row.id, {
      kind: 'meeting.held',
      title: `Встреча: ${row.topic}`,
      details: row.result,
      cooperationId: row.cooperationId,
      programName: row.program?.name ?? null,
      href: cooperationHref(row.cooperationId),
      author: row.responsible,
      occurredAt: row.date,
    }))
  }

  for (const row of sources.documents) {
    events.push(event('document', row.id, {
      kind: 'document.status',
      title: documentEventTitle(row.document.title, row.document.version, row.toStatus),
      details: hideInternal ? null : row.comment,
      cooperationId: row.document.cooperationId,
      programName: row.document.program?.name ?? null,
      href: '/documents',
      author: row.changedBy,
      occurredAt: row.changedAt,
    }))
  }

  for (const row of sources.applications) {
    events.push(event('application', row.id, {
      kind: 'application.submitted',
      title: applicationEventTitle(row.quantity, row.program.name),
      details: row.comment,
      cooperationId: null,
      programName: row.program.name,
      href: null,
      author: row.createdBy,
      occurredAt: row.submittedAt,
    }))
  }

  for (const row of sources.recommendations) {
    events.push(event('recommendation', row.id, {
      kind: 'recommendation.created',
      title: `Рекомендация: ${row.title}`,
      details: null,
      cooperationId: row.cooperationId,
      programName: null,
      href: '/recommendations',
      author: null,
      occurredAt: row.createdAt,
    }))
  }

  for (const row of sources.recommendationStatuses) {
    const payload = (row.payload ?? {}) as { to?: RecommendationStatus }
    const status = payload.to ? RECOMMENDATION_STATUS_LABELS[payload.to] : null
    events.push(event('recommendation', `status:${row.id}`, {
      kind: 'recommendation.status',
      title: status ? `Рекомендация: статус «${status}»` : 'Рекомендация: изменён статус',
      details: null,
      cooperationId: null,
      programName: null,
      href: '/recommendations',
      author: row.user,
      occurredAt: row.createdAt,
    }))
  }

  for (const row of sources.contacts) {
    events.push(event('contact', row.id, {
      kind: row.action,
      // Только факт: кто из контактов — не называется, ФИО в ленту не попадает.
      title: AUDIT_ACTION_LABELS[row.action as AuditActionCode] ?? row.action,
      details: null,
      cooperationId: null,
      programName: null,
      href: null,
      author: row.user,
      occurredAt: row.createdAt,
    }))
  }

  for (const row of sources.audit) {
    const payload = (row.payload ?? {}) as Record<string, unknown>
    events.push(event('audit', row.id, {
      kind: row.action,
      title: AUDIT_ACTION_LABELS[row.action as AuditActionCode] ?? row.action,
      details: auditDetails(row.action, payload),
      cooperationId: null,
      programName: null,
      href: null,
      author: row.user,
      occurredAt: row.createdAt,
    }))
  }

  return events
}

function auditDetails(action: string, payload: Record<string, unknown>): string | null {
  if (action === 'university.update') return describeFields(payload.fields)
  if (action === 'university.merge') {
    const moved = (payload.moved ?? {}) as Record<string, number>
    const name = typeof payload.sourceName === 'string' ? `«${payload.sourceName}»` : 'дубль'
    return `Слит ${name}: программ ${moved.programs ?? 0}, связок ${moved.cooperations ?? 0}, контактов ${moved.contacts ?? 0}`
  }
  if (action === 'university.merge.undo') return 'Объекты возвращены вузу-дублю'
  return null
}
