import { describe, expect, it } from 'vitest'
import { containsContactDetails, createMasker } from './ai-story.masking'

/**
 * Обратимое обезличивание «Истории сотрудничества» (решение 138): почта, телефон
 * РФ в разных форматах и ФИО из известных списков заменяются метками и возвращаются
 * обратно ровно тем же текстом, что был. Официальные названия вуза не трогаются.
 */

const PEOPLE = {
  staff: ['Петров Игорь Сергеевич'],
  contacts: ['Ветрова Ирина Павловна'],
}

describe('createMasker: почта и телефон', () => {
  it('прячет почту и возвращает её обратно', () => {
    const masker = createMasker(PEOPLE)
    const masked = masker.mask('Пишите на contact@spbgut.example.invalid по вопросу')
    expect(masked).not.toContain('contact@spbgut.example.invalid')
    expect(masked).toMatch(/\[ПОЧТА_1\]/)
    expect(masker.restore(masked)).toBe('Пишите на contact@spbgut.example.invalid по вопросу')
  })

  it.each([
    '+7 (812) 555-12-34',
    '8 812 555 12 34',
    '8-999-123-45-67',
    '+79991234567',
    '88125551234',
  ])('прячет телефон РФ в формате «%s» и возвращает его обратно', (phone) => {
    const masker = createMasker(PEOPLE)
    const masked = masker.mask(`Звоните: ${phone}, ждём с утра`)
    expect(masked).not.toContain(phone)
    expect(masked).toMatch(/\[ТЕЛЕФОН_1\]/)
    expect(masker.restore(masked)).toBe(`Звоните: ${phone}, ждём с утра`)
  })

  it('несколько разных телефонов получают разные метки', () => {
    const masker = createMasker(PEOPLE)
    const text = 'Основной: +7 (812) 555-12-34, запасной: 8-999-123-45-67'
    const masked = masker.mask(text)
    expect(masked).toMatch(/\[ТЕЛЕФОН_1\]/)
    expect(masked).toMatch(/\[ТЕЛЕФОН_2\]/)
    expect(masker.restore(masked)).toBe(text)
  })
})

describe('createMasker: ФИО из известных списков', () => {
  it('контактное лицо целиком — одна метка', () => {
    const masker = createMasker(PEOPLE)
    const masked = masker.mask('Встречались с Ветрова Ирина Павловна на прошлой неделе')
    expect(masked).not.toContain('Ветрова Ирина Павловна')
    expect(masked).toMatch(/\[КОНТАКТ_1\]/)
    expect(masker.restore(masked)).toBe('Встречались с Ветрова Ирина Павловна на прошлой неделе')
  })

  it('сотрудник в форме «Фамилия И. О.» — своя метка, отдельная от контакта', () => {
    const masker = createMasker(PEOPLE)
    const masked = masker.mask('Ответственный — Петров И. С., контакт — Ветрова И. П.')
    expect(masked).toMatch(/\[СОТРУДНИК_1\]/)
    expect(masked).toMatch(/\[КОНТАКТ_1\]/)
    expect(masker.restore(masked)).toBe('Ответственный — Петров И. С., контакт — Ветрова И. П.')
  })

  it('одна и та же строка — всегда одна и та же метка', () => {
    const masker = createMasker(PEOPLE)
    const first = masker.mask('Петров Игорь Сергеевич встретился с вузом')
    const second = masker.mask('Ещё раз про Петров Игорь Сергеевич')
    const label = /\[СОТРУДНИК_1\]/
    expect(first).toMatch(label)
    expect(second).toMatch(label)
  })

  it('ФИО не из базы, но по шаблону «Фамилия И. О.», — метка «ЛИЦО»', () => {
    const masker = createMasker(PEOPLE)
    const masked = masker.mask('Письмо подписал Сидоров А. Н.')
    expect(masked).not.toContain('Сидоров А. Н.')
    expect(masked).toMatch(/\[ЛИЦО_1\]/)
    expect(masker.restore(masked)).toBe('Письмо подписал Сидоров А. Н.')
  })
})

describe('createMasker: официальные названия защищены', () => {
  it('название вуза из `keep` не превращается в метку', () => {
    const masker = createMasker(PEOPLE, ['Университет имени М. А. Бонч-Бруевича'])
    const text = 'Вуз: Университет имени М. А. Бонч-Бруевича, программа «Связь»'
    const masked = masker.mask(text)
    expect(masked).toContain('Университет имени М. А. Бонч-Бруевича')
    expect(masker.restore(masked)).toBe(text)
  })
})

describe('createMasker: метки модели', () => {
  it('unknownLabels ловит метку, которую маскировщик не выдавал', () => {
    const masker = createMasker(PEOPLE)
    masker.mask('Контакт: Ветрова Ирина Павловна')
    expect(masker.unknownLabels('Всё хорошо, см. [КОНТАКТ_1]')).toEqual([])
    expect(masker.unknownLabels('Придумано: [КОНТАКТ_99]')).toEqual(['[КОНТАКТ_99]'])
  })

  it('restore не трогает незнакомую метку', () => {
    const masker = createMasker(PEOPLE)
    expect(masker.restore('Есть [ЛИЦО_5], которого не было')).toBe('Есть [ЛИЦО_5], которого не было')
  })
})

describe('containsContactDetails', () => {
  it('находит почту и телефон в свободном тексте', () => {
    expect(containsContactDetails('Пишите на test@example.invalid')).toBe(true)
    expect(containsContactDetails('Звоните: +7 (812) 555-12-34')).toBe(true)
    expect(containsContactDetails('Ничего личного здесь нет, только цифры: 5 из 13')).toBe(false)
  })
})
