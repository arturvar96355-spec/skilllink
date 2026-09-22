import { describe, expect, it } from 'vitest'
import type { Metric } from '@/shared/contracts'
import {
  NO_DATA,
  abbreviate,
  formatDeadlineDistance,
  formatMetric,
  formatNumber,
  formatPercent,
  formatRelative,
  formatScore,
  initials,
  pluralize,
} from './format'

function metric(value: number | null, unit: string, basis: Metric['basis'] = 'actual'): Metric {
  return { value, unit, basis, explanation: 'тест' }
}

/**
 * Главное правило проекта в разметке: пустое значение печатается словами
 * «Нет данных» и никогда нулём (решение 8). Ноль читается как «плохо»,
 * а правда — «мы не знаем», и подмена делает всю аналитику ложью.
 */
describe('пустые показатели', () => {
  it('null никогда не превращается в ноль', () => {
    expect(formatNumber(null)).toBe(NO_DATA)
    expect(formatScore(null)).toBe(NO_DATA)
    expect(formatPercent(null)).toBe(NO_DATA)
    expect(formatMetric(metric(null, 'шт'))).toBe(NO_DATA)
    expect(formatMetric(null)).toBe(NO_DATA)

    for (const text of [formatNumber(null), formatScore(null), formatMetric(metric(null, '%'))]) {
      expect(text).not.toContain('0')
    }
  })

  it('настоящий ноль показывается как ноль', () => {
    expect(formatNumber(0)).toBe('0')
    expect(formatMetric(metric(0, 'шт'))).toBe('0')
  })
})

describe('числа', () => {
  it('балл рейтинга всегда с одним знаком после запятой', () => {
    // Иначе столбец в таблице прыгает: 79,1 рядом с 28 выглядит как разная точность.
    expect(formatScore(79.14)).toBe('79,1')
    expect(formatScore(28)).toBe('28,0')
  })

  it('единица измерения приклеивается по своим правилам', () => {
    expect(formatMetric(metric(88.9, '%'))).toBe('88,9%')
    expect(formatMetric(metric(12, 'шт'))).toBe('12')
    expect(formatMetric(metric(204, 'дней'))).toBe('204 дней')
  })
})

describe('склонения', () => {
  it.each([
    [1, 'день'],
    [2, 'дня'],
    [5, 'дней'],
    [11, 'дней'],
    [21, 'день'],
    [104, 'дня'],
    [111, 'дней'],
  ])('%i → %s', (count, expected) => {
    expect(pluralize(count, ['день', 'дня', 'дней'])).toBe(expected)
  })
})

describe('сроки', () => {
  it('отрицательное число дней — это просрочка, а не «осталось»', () => {
    expect(formatDeadlineDistance(-5)).toBe('просрочен на 5 дней')
    expect(formatDeadlineDistance(0)).toBe('срок сегодня')
    expect(formatDeadlineDistance(3)).toContain('3 дня')
    expect(formatDeadlineDistance(null)).toBeNull()
  })
})

describe('давность события', () => {
  const now = Date.parse('2026-09-22T12:00:00.000Z')

  it('считается от переданного момента, а не от текущего времени', () => {
    expect(formatRelative('2026-09-22T11:59:30.000Z', now)).toBe('только что')
    expect(formatRelative('2026-09-22T11:46:00.000Z', now)).toBe('14 минут назад')
    expect(formatRelative('2026-09-22T09:00:00.000Z', now)).toBe('3 часа назад')
    expect(formatRelative('2026-09-21T12:00:00.000Z', now)).toBe('вчера')
  })

  it('давнее событие показывается датой', () => {
    expect(formatRelative('2026-08-01T12:00:00.000Z', now)).toBe('01.08.2026')
  })
})

describe('сокращения', () => {
  it('инициалы берутся из фамилии и имени', () => {
    expect(initials('Кириллов Пётр Андреевич')).toBe('КП')
    expect(initials('Пётр')).toBe('ПЁ')
  })

  it('аббревиатура программы пропускает предлоги', () => {
    expect(abbreviate('Программная инженерия')).toBe('ПИ')
    expect(abbreviate('Инфокоммуникационные технологии и системы связи')).toBe('ИТ')
  })
})
