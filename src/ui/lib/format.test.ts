import { describe, expect, it } from 'vitest'
import type { Metric } from '@/shared/contracts'
import {
  NO_DATA,
  abbreviate,
  deadlineBadgeText,
  formatDeadlineDistance,
  formatMetric,
  formatNumber,
  formatPercent,
  formatRelative,
  formatScore,
  initials,
  pluralize,
  dateTimeInputToIso,
  dateToDateTimeInput,
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

  it('в день срока значок пишет «сегодня», а не «0 дн.»', () => {
    // Срок этапа — точный момент: к вечеру дня срока этап уже просрочен,
    // а календарных дней прошло ноль.
    expect(deadlineBadgeText('overdue', 0)).toBe('Срок вышел сегодня')
    expect(deadlineBadgeText('overdue', 0, true)).toBe('сегодня')
    expect(deadlineBadgeText('overdue', -58)).toBe('Просрочен на 58 дн.')
    expect(deadlineBadgeText('overdue', -58, true)).toBe('−58 дн.')
    expect(deadlineBadgeText('dueSoon', 0)).toBe('Срок сегодня')
    expect(deadlineBadgeText('dueSoon', 2, true)).toBe('2 дн.')
    for (const kind of ['overdue', 'dueSoon'] as const) {
      for (const compact of [false, true]) {
        expect(deadlineBadgeText(kind, 0, compact)).not.toMatch(/\b0 дн/)
      }
    }
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

describe('поле «дата и время» — по Москве, в каком бы поясе ни был браузер', () => {
  it('14:30 в поле — это 11:30 UTC', () => {
    // Раньше время читалось поясом браузера: в Екатеринбурге 14:30 уходило как 09:30 UTC
    // и показывалось как 12:30 по Москве.
    expect(dateTimeInputToIso('2026-09-23T14:30')).toBe('2026-09-23T11:30:00.000Z')
  })

  it('момент времени заполняет поле московским временем', () => {
    expect(dateToDateTimeInput(new Date('2026-09-23T21:30:00.000Z'))).toBe('2026-09-24T00:30')
  })

  it('туда и обратно — то же значение', () => {
    const value = '2026-12-31T23:59'
    expect(dateToDateTimeInput(new Date(dateTimeInputToIso(value)!))).toBe(value)
  })

  it('пустое поле — нет даты', () => {
    expect(dateTimeInputToIso('')).toBeNull()
  })
})

describe('склонение по числу', () => {
  const forms: [string, string, string] = ['вуз', 'вуза', 'вузов']

  it('целые — по последней цифре', () => {
    expect(pluralize(1, forms)).toBe('вуз')
    expect(pluralize(4, forms)).toBe('вуза')
    expect(pluralize(11, forms)).toBe('вузов')
    expect(pluralize(204, ['день', 'дня', 'дней'])).toBe('дня')
  })

  it('дробные — в родительном падеже единственного числа', () => {
    // «8,6 операции», а не «8,6 операций»; «89,1 процента», а не «процентов».
    expect(pluralize(8.6, ['операция', 'операции', 'операций'])).toBe('операции')
    expect(pluralize(89.1, ['процент', 'процента', 'процентов'])).toBe('процента')
  })
})

