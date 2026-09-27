import { describe, expect, it } from 'vitest'
import { isPlaceholderReference } from './url'

describe('ссылка-заглушка (решение 212)', () => {
  it('зарезервированные для примеров домены — заглушка', () => {
    expect(isPlaceholderReference('https://example.invalid/docs/nda-1.pdf')).toBe(true)
    expect(isPlaceholderReference('https://files.example.com/a.pdf')).toBe(true)
  })
  it('рабочие адреса и пустое значение — не заглушка', () => {
    expect(isPlaceholderReference('https://disk.yandex.ru/d/abc')).toBe(false)
    expect(isPlaceholderReference(null)).toBe(false)
    expect(isPlaceholderReference('не адрес')).toBe(false)
  })
})
