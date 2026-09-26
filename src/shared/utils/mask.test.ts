import { describe, expect, it } from 'vitest'
import { maskEmailForDisplay, maskPhoneForDisplay } from './mask'

describe('маски почты и телефона для ответов (решение 133)', () => {
  it('почта: первая буква и домен', () => {
    expect(maskEmailForDisplay('ivanov@x.ru')).toBe('i***@x.ru')
    expect(maskEmailForDisplay('  a.b@univ.example.ru ')).toBe('a***@univ.example.ru')
    expect(maskEmailForDisplay('не почта')).toBe('***')
    expect(maskEmailForDisplay(null)).toBeNull()
    expect(maskEmailForDisplay('')).toBeNull()
  })

  it('телефон: код страны и две последние цифры, длина не выдаётся', () => {
    expect(maskPhoneForDisplay('+7 (900) 123-45-71')).toBe('+7******71')
    expect(maskPhoneForDisplay('8 900 123 45 71')).toBe('+7******71')
    expect(maskPhoneForDisplay('+44 20 7946 0958')).toBe('+4******58')
    expect(maskPhoneForDisplay('123-45')).toBe('******45')
    expect(maskPhoneForDisplay(null)).toBeNull()
  })
})
