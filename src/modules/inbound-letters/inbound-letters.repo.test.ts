import { describe, expect, it } from 'vitest'
import { buildWhere } from './inbound-letters.repo'
import type { InboundLetterListQuery } from './inbound-letters.schema'

/**
 * Условие поиска писем (решение 184): по образцу `buildWhere` связок
 * (`cooperation.repo.ts`) — проверяется на самом объекте условия, без базы.
 */

function query(overrides: Partial<InboundLetterListQuery> = {}): InboundLetterListQuery {
  return { page: 1, pageSize: 20, ...overrides }
}

describe('поиск писем по ключевым словам', () => {
  it('ищет по теме, тексту, отправителю и вузу', () => {
    const where = buildWhere(query({ q: 'СПбГУТ' }), {}) as { AND: Array<{ OR: object[] }> }
    const fields = where.AND[0]?.OR ?? []
    expect(fields).toContainEqual({ subject: { contains: 'СПбГУТ', mode: 'insensitive' } })
    expect(fields).toContainEqual({ bodyText: { contains: 'СПбГУТ', mode: 'insensitive' } })
    expect(fields).toContainEqual({ senderEmail: { contains: 'СПбГУТ', mode: 'insensitive' } })
    expect(fields).toContainEqual({ senderName: { contains: 'СПбГУТ', mode: 'insensitive' } })
    expect(fields).toContainEqual({ university: { name: { contains: 'СПбГУТ', mode: 'insensitive' } } })
  })

  it('каждое слово запроса — отдельное условие: «перенести встречу» ищет оба слова', () => {
    const where = buildWhere(query({ q: 'перенести встречу' }), {}) as { AND: Array<{ OR: object[] }> }
    expect(where.AND).toHaveLength(2)
    expect(where.AND[1]?.OR).toContainEqual({ subject: { contains: 'встречу', mode: 'insensitive' } })
  })

  it('без запроса — условия по тексту нет', () => {
    const where = buildWhere(query(), {})
    expect(where.AND).toBeUndefined()
  })

  it('поиск не отменяет остальные фильтры и область видимости', () => {
    const where = buildWhere(
      query({ q: 'Иванов', status: ['NEW'], group: ['MEETING'], universityId: 'uni-1' }),
      { OR: [{ university: { responsibleId: 'user-1' } }] },
    )
    expect(where.status).toEqual({ in: ['NEW'] })
    expect(where.group).toEqual({ in: ['MEETING'] })
    expect(where.universityId).toBe('uni-1')
    expect(where.OR).toEqual([{ university: { responsibleId: 'user-1' } }])
    expect(where.AND).toHaveLength(1)
  })
})
