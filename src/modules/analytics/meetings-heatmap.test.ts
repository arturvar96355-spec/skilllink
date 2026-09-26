import { describe, expect, it } from 'vitest'
import { buildHeatmap, DAY_LABELS, heatmapCell } from './meetings-heatmap.rules'

/**
 * Тепловая карта встреч (решение 134): день недели и час по Москве, форма 7×24.
 * Настоящая выборка из базы и university-scope — в пробнике.
 */

describe('heatmapCell', () => {
  it('переводит дату в московское время: 2026-03-02 09:15 UTC — понедельник, 12 часов МСК', () => {
    // 2 марта 2026 — понедельник; Москва круглый год UTC+3, перевода на летнее нет.
    const cell = heatmapCell(new Date('2026-03-02T09:15:00Z'), 'Europe/Moscow')
    expect(cell).toEqual({ day: 0, hour: 12 })
  })

  it('воскресенье поздним вечером МСК — последний день недели, час 23', () => {
    // 2026-03-08 — воскресенье; 23:30 МСК = 20:30 UTC.
    const cell = heatmapCell(new Date('2026-03-08T20:30:00Z'), 'Europe/Moscow')
    expect(cell).toEqual({ day: 6, hour: 23 })
  })

  it('полночь МСК переходит на следующий день недели', () => {
    // 2026-03-02 (понедельник) 00:30 МСК = 2026-03-01 21:30 UTC (воскресенье).
    const cell = heatmapCell(new Date('2026-03-01T21:30:00Z'), 'Europe/Moscow')
    expect(cell).toEqual({ day: 0, hour: 0 })
  })
})

describe('buildHeatmap', () => {
  it('форма всегда 7×24, даже без встреч', () => {
    const cells = buildHeatmap([])
    expect(cells).toHaveLength(7)
    for (const row of cells) expect(row).toHaveLength(24)
    expect(cells.flat().every((value) => value === 0)).toBe(true)
    expect(DAY_LABELS).toHaveLength(7)
  })

  it('считает встречи в правильную клетку и суммирует повторы', () => {
    const cells = buildHeatmap([
      new Date('2026-03-02T09:15:00Z'), // Пн 12:00 МСК
      new Date('2026-03-02T09:45:00Z'), // Пн 12:00 МСК — та же клетка
      new Date('2026-03-08T20:30:00Z'), // Вс 23:00 МСК
    ])
    expect(cells[0]![12]).toBe(2)
    expect(cells[6]![23]).toBe(1)
    expect(cells.flat().reduce((sum, value) => sum + value, 0)).toBe(3)
  })
})
