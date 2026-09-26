import { describe, expect, it } from 'vitest'
import {
  catalogNameKey,
  formatPhoneE164,
  isPlausibleNamePart,
  isValidEmail,
  normalizeEmail,
  normalizeNamePart,
  normalizeRuPhoneDigits,
  stripOuterQuotes,
} from './contacts'

describe('телефон', () => {
  it.each([
    ['7 (999) 023-43-65', '79990234365'],
    ['+7 (999) 023-43-65', '79990234365'],
    ['+7 999 023 43 65', '79990234365'],
    ['8 999 023-43-65', '79990234365'],
    ['8(999)0234365', '79990234365'],
    ['9990234365', '79990234365'],
    ['79990234365', '79990234365'],
    [' +7.999.023.43.65 ', '79990234365'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeRuPhoneDigits(raw)).toBe(expected)
  })

  it.each(['12345', '+1 202 555 0100', '6 999 023 43 65', '7999023436', '799902343655', 'тел. 79990234365', '+7 999 023-43-65 доб. 12'])(
    'не угадывает: %s → null',
    (raw) => {
      expect(normalizeRuPhoneDigits(raw)).toBeNull()
    },
  )

  it('пусто — null, для делового контакта — +7XXXXXXXXXX', () => {
    expect(normalizeRuPhoneDigits('  ')).toBeNull()
    expect(normalizeRuPhoneDigits(null)).toBeNull()
    expect(formatPhoneE164('79990234365')).toBe('+79990234365')
  })
})

describe('почта', () => {
  it('нижний регистр и пробелы по краям', () => {
    expect(normalizeEmail('  Osipenko833484@Mail.RU ')).toBe('osipenko833484@mail.ru')
    expect(normalizeEmail('')).toBeNull()
  })

  it.each(['max_crich@mail.ru', 'a.b-c+d@sub.example.invalid', 'иван@почта.рф'])('годится: %s', (email) => {
    expect(isValidEmail(email)).toBe(true)
  })

  it.each(['не-почта', 'a@b', 'a@@b.ru', 'a b@c.ru', '@mail.ru', 'a@mail.', 'a@-mail.ru'])('не годится: %s', (email) => {
    expect(isValidEmail(email)).toBe(false)
  })
})

describe('ФИО', () => {
  it('пробелы и заглавная буква, двойная фамилия', () => {
    expect(normalizeNamePart('  примеров ')).toBe('Примеров')
    expect(normalizeNamePart('пётр')).toBe('Пётр')
    expect(normalizeNamePart('петрова-водкина')).toBe('Петрова-Водкина')
    expect(normalizeNamePart('Анна  Мария')).toBe('Анна Мария')
    expect(normalizeNamePart('МакКуин')).toBe('МакКуин')
  })

  it('цифры и «@» в имени не бывают', () => {
    expect(isPlausibleNamePart('Иван')).toBe(true)
    expect(isPlausibleNamePart("Д'Артаньян")).toBe(true)
    expect(isPlausibleNamePart('Иван2')).toBe(false)
    expect(isPlausibleNamePart('ivan@mail.ru')).toBe(false)
  })
})

describe('ключ названия', () => {
  it('без кавычек, регистра и пробелов — как skillNameKey, плюс кавычки', () => {
    expect(catalogNameKey('ООО «Базис»')).toBe(catalogNameKey('ооо "Базис"'))
    expect(catalogNameKey('«Базис Dynamix»')).toBe(catalogNameKey('Базис  dynamix'))
    expect(catalogNameKey('Управление ИТ-проектами на базе продукта ПАО «Ростелеком»')).toBe(
      catalogNameKey('Управление ИТ-проектами на базе продукта ПАО "Ростелеком"'),
    )
    expect(catalogNameKey('RT.DataLake')).not.toBe(catalogNameKey('RT.Warehouse'))
  })

  it('внешние кавычки снимаются, внутренние остаются', () => {
    expect(stripOuterQuotes('«Базис Dynamix»')).toBe('Базис Dynamix')
    expect(stripOuterQuotes('ООО «Базис»')).toBe('ООО «Базис»')
    expect(stripOuterQuotes('  "Яга" ')).toBe('Яга')
  })
})
