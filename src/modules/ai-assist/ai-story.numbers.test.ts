import { describe, expect, it } from 'vitest'
import { numberTokens, unknownNumbers } from './ai-story.numbers'

/**
 * «Числа считает код» (решение 138): каждое число и дата в ответе модели должны
 * встречаться среди чисел и дат фактов — иначе ответ отбрасывается.
 */

describe('unknownNumbers', () => {
  const facts = [
    'Пройдено этапов: 5 из 13',
    'Текущий этап: 6 «Подписание документов»',
    'Срок: 30.07.2026',
    'Встречи: 2, последняя 15.09.2026',
  ]

  it('число из фактов — не считается неизвестным', () => {
    expect(unknownNumbers('Пройдено 5 из 13 этапов.', facts)).toEqual([])
  })

  it('число, которого нет в фактах, — неизвестное', () => {
    // Не 7: оно совпало бы с месяцем даты «30.07.2026» среди чисел фактов —
    // проверка числами не различает смысл, только значение, это её осознанное
    // ограничение (см. комментарий в ai-story.numbers.ts).
    expect(unknownNumbers('Пройдено 8 из 13 этапов.', facts)).toEqual(['8'])
  })

  it('дата в числовом виде из фактов совпадает без года и с ним', () => {
    expect(unknownNumbers('Срок был 30.07, прошло много времени.', facts)).toEqual([])
    expect(unknownNumbers('Срок был 30.07.2026.', facts)).toEqual([])
  })

  it('дата словами сверяется по дню и месяцу', () => {
    expect(unknownNumbers('Срок был 30 июля 2026 года.', facts)).toEqual([])
  })

  it('выдуманная дата — неизвестная', () => {
    expect(unknownNumbers('Срок был 31.07.2026.', facts)).toEqual(['31.7'])
  })

  it('числительное словами сверяется с числом из фактов', () => {
    expect(unknownNumbers('Прошло две встречи.', facts)).toEqual([])
    expect(unknownNumbers('Прошло три встречи.', facts)).toEqual(['3'])
  })

  it('дробное число (через запятую — как в фактах) сверяется как есть', () => {
    expect(unknownNumbers('Заполнено 4,5 позиции из плана.', ['Показатель: 4,5'])).toEqual([])
  })

  it('метки маскировки не считаются числами', () => {
    expect(unknownNumbers('Ответственный [СОТРУДНИК_12] на связи.', facts)).toEqual([])
  })

  it('пустой ответ без чисел — ничего неизвестного', () => {
    expect(unknownNumbers('Связка развивается по плану.', facts)).toEqual([])
  })
})

describe('numberTokens', () => {
  it('в режиме фактов дата разбирается ещё и на отдельные день и месяц', () => {
    const tokens = numberTokens('Срок: 30.07.2026', true)
    expect(tokens.numbers.has('30')).toBe(true)
    expect(tokens.numbers.has('7')).toBe(true)
    expect(tokens.numbers.has('2026')).toBe(true)
    expect(tokens.dayMonths.has('30.7')).toBe(true)
  })
})
