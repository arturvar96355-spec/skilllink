import { describe, expect, it } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { UserRole } from '@/shared/contracts/enums'
import type { TimelineEventDto } from '@/shared/contracts/data-quality'
import {
  allowedTimelineTypes,
  compareEvents,
  decodeCursor,
  describeFields,
  encodeCursor,
  isAfterCursor,
  pageOfEvents,
} from './timeline.rules'
import { toEvents } from './timeline.service'
import type { TimelineSources } from './timeline.repo'

/**
 * Лента 360 вуза (решение 134): курсорная пагинация, порядок событий, права
 * на типы событий, скрытие внутренних заметок от представителя вуза. Настоящий
 * запрос к базе — в пробнике (checkDataQuality).
 */

const as = (role: UserRole): CurrentUser => ({
  id: 'me',
  email: 'me@skilllink.demo',
  fullName: 'Текущий',
  role,
  universityId: role === 'UNIVERSITY_REP' ? 'uni' : null,
})

describe('allowedTimelineTypes', () => {
  it('представителю вуза недоступны рекомендации, ПД-факты и внутренний журнал', () => {
    const types = allowedTimelineTypes(as('UNIVERSITY_REP'), undefined)
    expect(types).toEqual(['cooperation', 'stage', 'meeting', 'document', 'application'])
  })

  it('администратору доступны все типы', () => {
    const types = allowedTimelineTypes(as('ADMIN'), undefined)
    expect(types).toContain('recommendation')
    expect(types).toContain('contact')
    expect(types).toContain('audit')
  })

  it('запрошенный, но недоступный тип просто не входит — не ошибка', () => {
    const types = allowedTimelineTypes(as('UNIVERSITY_REP'), ['stage', 'audit'])
    expect(types).toEqual(['stage'])
  })

  it('пустой список запрошенных типов — как «все»', () => {
    expect(allowedTimelineTypes(as('MANAGER'), [])).toEqual(allowedTimelineTypes(as('MANAGER'), undefined))
  })
})

describe('курсор', () => {
  it('кодирует и раскодирует время и id', () => {
    const cursor = encodeCursor({ occurredAt: '2026-03-01T10:00:00.000Z', id: 'stage:1' })
    expect(decodeCursor(cursor)).toEqual({ at: new Date('2026-03-01T10:00:00.000Z'), id: 'stage:1' })
  })

  it('битую строку отклоняет с понятной ошибкой', () => {
    expect(() => decodeCursor('не курсор совсем')).toThrow()
    expect(() => decodeCursor(Buffer.from('nodelimiterhere', 'utf8').toString('base64url'))).toThrow()
  })
})

describe('compareEvents / isAfterCursor', () => {
  const event = (id: string, occurredAt: string): TimelineEventDto => ({
    id, type: 'stage', kind: 'stage.status', title: id, details: null,
    cooperationId: null, programName: null, href: null, author: null, occurredAt,
  })

  it('новые сверху', () => {
    const early = event('a', '2026-01-01T00:00:00.000Z')
    const late = event('b', '2026-02-01T00:00:00.000Z')
    expect(compareEvents(late, early)).toBeLessThan(0)
    expect(compareEvents(early, late)).toBeGreaterThan(0)
  })

  it('при равном времени — по id по убыванию', () => {
    const a = event('a', '2026-01-01T00:00:00.000Z')
    const b = event('b', '2026-01-01T00:00:00.000Z')
    expect(compareEvents(b, a)).toBeLessThan(0)
  })

  it('без курсора любое событие «после»; с курсором — строго раньше него', () => {
    const cursor = { at: new Date('2026-01-01T00:00:00.000Z'), id: 'b' }
    expect(isAfterCursor(event('x', '2026-02-01T00:00:00.000Z'), null)).toBe(true)
    expect(isAfterCursor(event('a', '2026-01-01T00:00:00.000Z'), cursor)).toBe(true) // тот же момент, id меньше
    expect(isAfterCursor(event('c', '2026-01-01T00:00:00.000Z'), cursor)).toBe(false) // тот же момент, id больше
    expect(isAfterCursor(event('z', '2026-02-01T00:00:00.000Z'), cursor)).toBe(false) // позже курсора
  })
})

describe('pageOfEvents', () => {
  const event = (id: string, occurredAt: string): TimelineEventDto => ({
    id, type: 'stage', kind: 'stage.status', title: id, details: null,
    cooperationId: null, programName: null, href: null, author: null, occurredAt,
  })
  const events = [
    event('e1', '2026-03-05T00:00:00.000Z'),
    event('e2', '2026-03-04T00:00:00.000Z'),
    event('e3', '2026-03-03T00:00:00.000Z'),
    event('e4', '2026-03-02T00:00:00.000Z'),
  ]

  it('первая страница: limit штук, курсор на последнее показанное', () => {
    const page = pageOfEvents(events, null, 2)
    expect(page.items.map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).not.toBeNull()
  })

  it('вторая страница по курсору первой — не повторяет и не пропускает события', () => {
    const first = pageOfEvents(events, null, 2)
    const cursor = decodeCursor(first.nextCursor!)
    const second = pageOfEvents(events, cursor, 2)
    expect(second.items.map((e) => e.id)).toEqual(['e3', 'e4'])
    expect(second.hasMore).toBe(false)
    expect(second.nextCursor).toBeNull()
  })

  it('дубликаты по id (событие пришло из двух источников) схлопываются', () => {
    const page = pageOfEvents([...events, event('e1', '2026-03-05T00:00:00.000Z')], null, 10)
    expect(page.items.filter((e) => e.id === 'e1')).toHaveLength(1)
  })
})

describe('describeFields', () => {
  it('переводит имена полей вуза словами', () => {
    expect(describeFields(['name', 'inn'])).toBe('Поля: название, ИНН')
  })

  it('пусто или не массив — null', () => {
    expect(describeFields(undefined)).toBeNull()
    expect(describeFields([])).toBeNull()
  })
})

describe('toEvents', () => {
  const author = { id: 'u1', fullName: 'Иван Иванов', role: 'MANAGER' as const }
  const sources: TimelineSources = {
    cooperations: [{ id: 'coop1', createdAt: new Date('2026-01-01'), program: { name: 'Программная инженерия' }, product: null, responsible: author }],
    stages: [{
      id: 'sh1', toStatus: 'IN_PROGRESS', comment: 'Внутренняя заметка сотрудника', changedAt: new Date('2026-01-02'), changedBy: author,
      stage: { stageNumber: 1, title: 'Знакомство', result: 'Итог этапа', cooperationId: 'coop1', cooperation: { program: { name: 'Программная инженерия' } } },
    }],
    meetings: [],
    documents: [{
      id: 'dh1', toStatus: 'APPROVED', comment: 'Комментарий согласования', changedAt: new Date('2026-01-03'), changedBy: author,
      document: { id: 'doc1', title: 'Договор', version: '2', cooperationId: 'coop1', program: null },
    }],
    applications: [],
    recommendations: [],
    recommendationStatuses: [],
    contacts: [],
    audit: [],
  }

  it('строит события из всех источников с уникальным id и датой в ISO', () => {
    const events = toEvents(sources, false)
    expect(events).toHaveLength(3)
    expect(new Set(events.map((e) => e.id)).size).toBe(3)
    expect(events.every((e) => typeof e.occurredAt === 'string')).toBe(true)
  })

  it('представителю вуза (hideInternal) внутренний комментарий этапа и документа не показывается', () => {
    const visible = toEvents(sources, false).find((e) => e.type === 'stage')
    const hidden = toEvents(sources, true).find((e) => e.type === 'stage')
    expect(visible?.details).toBe('Внутренняя заметка сотрудника')
    expect(hidden?.details).toBe('Итог этапа') // видит только результат этапа, не комментарий

    const docVisible = toEvents(sources, false).find((e) => e.type === 'document')
    const docHidden = toEvents(sources, true).find((e) => e.type === 'document')
    expect(docVisible?.details).toBe('Комментарий согласования')
    expect(docHidden?.details).toBeNull()
  })
})
