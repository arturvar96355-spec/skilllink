import { describe, expect, it } from 'vitest'
import {
  isValidInn,
  isValidLegalEntityInn,
  isValidLegalEntityOgrn,
  isValidOgrn,
  legalEntityInnSchema,
  legalEntityOgrnSchema,
} from './inn-ogrn'

describe('ИНН', () => {
  it.each(['7707083893', '7736207543', '7830002293'])('10 цифр, верная контрольная: %s', (inn) => {
    expect(isValidInn(inn)).toBe(true)
    expect(isValidLegalEntityInn(inn)).toBe(true)
  })

  it.each(['500100732259', '773370857141'])('12 цифр, обе контрольные верны: %s', (inn) => {
    expect(isValidInn(inn)).toBe(true)
    // ИНН физлица и ИП у вуза не бывает.
    expect(isValidLegalEntityInn(inn)).toBe(false)
  })

  it('контрольная цифра посчитана вручную для 7707083893', () => {
    // 7·2 + 7·4 + 0·10 + 7·3 + 0·5 + 8·9 + 3·4 + 8·6 + 9·8 = 267; 267 mod 11 = 3; 3 mod 10 = 3.
    const sum = 7 * 2 + 7 * 4 + 0 * 10 + 7 * 3 + 0 * 5 + 8 * 9 + 3 * 4 + 8 * 6 + 9 * 8
    expect(sum).toBe(267)
    expect((sum % 11) % 10).toBe(3)
  })

  it.each([
    ['опечатка в контрольной', '7707083894'],
    ['перестановка соседних цифр', '7707038893'],
    ['12 цифр, неверна последняя', '500100732258'],
    ['12 цифр, неверна 11-я', '500100732269'],
    ['11 цифр', '77070838931'],
    ['9 цифр', '770708389'],
    ['буквы', '77070838ab'],
    ['одни нули', '0000000000'],
    ['пусто', ''],
  ])('%s — отклоняется', (_label, inn) => {
    expect(isValidInn(inn)).toBe(false)
  })
})

describe('ОГРН и ОГРНИП', () => {
  it.each(['1027700132195', '1027700229193', '1037739010891'])('ОГРН, 13 цифр: %s', (ogrn) => {
    expect(isValidOgrn(ogrn)).toBe(true)
    expect(isValidLegalEntityOgrn(ogrn)).toBe(true)
  })

  it('ОГРНИП, 15 цифр, остаток по модулю 13', () => {
    expect(isValidOgrn('304500116000157')).toBe(true)
    expect(isValidLegalEntityOgrn('304500116000157')).toBe(false)
  })

  it('контрольная ОГРН посчитана вручную для 1027700132195', () => {
    // 102770013219 mod 11 = 5 — BigInt здесь только для сверки, сама проверка без него.
    expect(Number(102770013219n % 11n) % 10).toBe(5)
  })

  it.each([
    ['опечатка в контрольной', '1027700132196'],
    ['ОГРНИП с неверной контрольной', '304500116000158'],
    ['14 цифр', '10277001321950'],
    ['одни нули', '0000000000000'],
    ['буквы', '10277001321a5'],
  ])('%s — отклоняется', (_label, ogrn) => {
    expect(isValidOgrn(ogrn)).toBe(false)
  })
})

describe('схемы ввода', () => {
  it('пробелы и дефисы снимаются, в результате только цифры', () => {
    expect(legalEntityInnSchema.parse('77 07-083893')).toBe('7707083893')
    expect(legalEntityOgrnSchema.parse('1 02 77 00 13 21 95')).toBe('1027700132195')
  })

  it('неверная контрольная — понятная ошибка по-русски', () => {
    const result = legalEntityInnSchema.safeParse('7707083894')
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toContain('контрольная цифра')
  })

  it('ИНН физлица в поле организации не проходит', () => {
    const result = legalEntityInnSchema.safeParse('500100732259')
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toContain('10 цифр')
  })
})
