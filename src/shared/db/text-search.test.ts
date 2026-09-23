import { describe, expect, it } from 'vitest'
import { escapeLike, textContains } from './text-search'

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
