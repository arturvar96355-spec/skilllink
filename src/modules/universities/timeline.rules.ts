import { can, type Permission } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import { TIMELINE_EVENT_TYPES, type TimelineEventDto, type TimelineEventType } from '@/shared/contracts/data-quality'
import { validationError } from '@/shared/http/errors'

/**
 * Лента 360 вуза (решение 134): правила доступа к типам событий, курсор,
 * склейка страниц. Чистые функции.
 */

/**
 * Какой тип событий кому виден.
 * - связки, этапы, встречи, документы, заявки — всем, кто видит вуз (READ; представитель —
 *   только свой вуз, внутренние комментарии ему скрыты);
 * - рекомендации — ANALYTICS: представителю вуза они недоступны (решение 9);
 * - основания обработки ПД контактов — CONTACT_BASIS: учёт оператора, только факт, без ФИО;
 * - изменения записи вуза (создание, правка, архив, слияние) — WRITE: это журнал работы
 *   сотрудников с карточкой, а не история отношений.
 */
export const TIMELINE_TYPE_PERMISSION: Record<TimelineEventType, Permission> = {
  cooperation: 'READ',
  stage: 'READ',
  meeting: 'READ',
  document: 'READ',
  application: 'READ',
  recommendation: 'ANALYTICS',
  contact: 'CONTACT_BASIS',
  audit: 'WRITE',
}

/**
 * Типы ленты: запрошенные (или все) ∩ разрешённые роли. Запрошенный недоступный
 * тип не ошибка, а просто не входит — ответ называет, какие вошли.
 */
export function allowedTimelineTypes(
  user: CurrentUser,
  requested: readonly TimelineEventType[] | undefined,
): TimelineEventType[] {
  const wanted = requested && requested.length > 0 ? requested : TIMELINE_EVENT_TYPES
  return TIMELINE_EVENT_TYPES.filter((type) => wanted.includes(type) && can(user, TIMELINE_TYPE_PERMISSION[type]))
}

export interface TimelineCursor {
  /** Время последнего показанного события. */
  at: Date
  /** Его id: события с одинаковым временем упорядочены по id. */
  id: string
}

/** Курсор — непрозрачная строка для фронта: base64url от «время|id». */
export function encodeCursor(event: Pick<TimelineEventDto, 'occurredAt' | 'id'>): string {
  return Buffer.from(`${event.occurredAt}|${event.id}`, 'utf8').toString('base64url')
}

export function decodeCursor(raw: string): TimelineCursor {
  const invalid = () => validationError('Некорректный курсор ленты', [{ field: 'cursor', message: 'Возьмите nextCursor из прошлого ответа' }])
  let text: string
  try {
    text = Buffer.from(raw, 'base64url').toString('utf8')
  } catch {
    throw invalid()
  }
  const separator = text.indexOf('|')
  if (separator <= 0) throw invalid()
  const at = new Date(text.slice(0, separator))
  const id = text.slice(separator + 1)
  if (Number.isNaN(at.getTime()) || id.length === 0 || id.length > 200) throw invalid()
  return { at, id }
}

/** Порядок ленты: новые сверху; при равном времени — по id по убыванию. */
export function compareEvents(left: TimelineEventDto, right: TimelineEventDto): number {
  if (left.occurredAt !== right.occurredAt) return left.occurredAt < right.occurredAt ? 1 : -1
  return left.id < right.id ? 1 : left.id > right.id ? -1 : 0
}

/** Событие строго после курсора (ниже по ленте). */
export function isAfterCursor(event: TimelineEventDto, cursor: TimelineCursor | null): boolean {
  if (!cursor) return true
  const at = cursor.at.toISOString()
  return event.occurredAt < at || (event.occurredAt === at && event.id < cursor.id)
}

/**
 * Страница ленты из событий всех источников. Каждый источник отдал не меньше
 * `limit + 1` своих событий после курсора (и все с тем же временем, что у курсора),
 * поэтому первые `limit` склеенных — точно первые `limit` всей ленты.
 */
export function pageOfEvents(
  events: readonly TimelineEventDto[],
  cursor: TimelineCursor | null,
  limit: number,
): { items: TimelineEventDto[]; nextCursor: string | null; hasMore: boolean } {
  const unique = new Map(events.filter((event) => isAfterCursor(event, cursor)).map((event) => [event.id, event]))
  const sorted = [...unique.values()].sort(compareEvents)
  const items = sorted.slice(0, limit)
  const hasMore = sorted.length > limit
  return { items, hasMore, nextCursor: hasMore && items.length > 0 ? encodeCursor(items.at(-1)!) : null }
}

/** Имена полей вуза в журнале правок — словами, для строки ленты. */
const UNIVERSITY_FIELD_LABELS: Record<string, string> = {
  name: 'название',
  shortName: 'краткое название',
  city: 'город',
  region: 'регион',
  address: 'адрес',
  website: 'сайт',
  status: 'статус',
  directionCount: 'число направлений',
  studentCount: 'число обучающихся',
  description: 'описание',
  inn: 'ИНН',
  ogrn: 'ОГРН',
}

export function describeFields(fields: unknown): string | null {
  if (!Array.isArray(fields) || fields.length === 0) return null
  return `Поля: ${fields.map((field) => UNIVERSITY_FIELD_LABELS[String(field)] ?? String(field)).join(', ')}`
}
