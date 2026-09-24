import { describe, expect, it } from 'vitest'
import {
  MAX_SEARCH_WORDS,
  escapeLike,
  everyWordInSomeField,
  searchWords,
  textContains,
} from './text-search'

describe('поиск по тексту', () => {
  it('знаки LIKE ищутся как обычные символы', () => {
    expect(escapeLike('_')).toBe('\\_')
    expect(escapeLike('скидка 10%')).toBe('скидка 10\\%')
    expect(escapeLike('C:\\путь')).toBe('C:\\\\путь')
  })

  it('обычный текст не меняется', () => {
    expect(escapeLike('Программная инженерия')).toBe('Программная инженерия')
  })

  it('поиск без учёта регистра', () => {
    expect(textContains('спбгут')).toEqual({ contains: 'спбгут', mode: 'insensitive' })
  })
})

describe('поиск по словам', () => {
  it('делит запрос на слова и не оставляет пустых', () => {
    expect(searchWords('  спбгут   программная ')).toEqual(['спбгут', 'программная'])
    expect(searchWords('   ')).toEqual([])
  })

  it('ограничивает число слов', () => {
    expect(searchWords('а б в г д е ж з')).toHaveLength(MAX_SEARCH_WORDS)
  })

  it('каждое слово ищется во всех полях, слова связаны «И»', () => {
    const where = everyWordInSomeField('СПбГУТ программная', (contains) => [
      { name: contains },
      { shortName: contains },
    ])
    expect(where).toEqual([
      {
        OR: [
          { name: { contains: 'СПбГУТ', mode: 'insensitive' } },
          { shortName: { contains: 'СПбГУТ', mode: 'insensitive' } },
        ],
      },
      {
        OR: [
          { name: { contains: 'программная', mode: 'insensitive' } },
          { shortName: { contains: 'программная', mode: 'insensitive' } },
        ],
      },
    ])
  })

  it('знаки LIKE экранируются и в словах', () => {
    const where = everyWordInSomeField('10%', (contains) => [{ name: contains }])
    expect(where[0]?.OR[0]).toEqual({ name: { contains: '10\\%', mode: 'insensitive' } })
  })
})
