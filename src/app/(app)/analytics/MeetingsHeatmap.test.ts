import { describe, expect, it } from 'vitest'
import { dayTotals, heatIntensity, heatmapConclusion } from './heatmap-color'

describe('MeetingsHeatmap: heatIntensity', () => {
  it('пустая клетка (0 встреч) — без цвета', () => {
    expect(heatIntensity(0, 10)).toBe(0)
  })

  it('пустая карта (максимум 0) — без цвета, без деления на ноль', () => {
    expect(heatIntensity(0, 0)).toBe(0)
  })

  it('самая занятая клетка — максимальная насыщенность', () => {
    expect(heatIntensity(10, 10)).toBe(100)
  })

  it('одна встреча против большого максимума всё равно заметна', () => {
    expect(heatIntensity(1, 50)).toBeGreaterThanOrEqual(15)
  })

  it('насыщенность растёт вместе со значением', () => {
    expect(heatIntensity(5, 10)).toBeLessThan(heatIntensity(8, 10))
  })
})

describe('MeetingsHeatmap: вывод одной фразой (решение 215)', () => {
  const cells = Array.from({ length: 7 }, (_, day) =>
    Array.from({ length: 24 }, (_, hour) => (day === 4 && hour >= 9 && hour <= 10 ? 5 : day === 0 && hour === 10 ? 2 : 0)),
  )

  it('итоги по дням', () => {
    expect(dayTotals(cells)).toEqual([2, 0, 0, 0, 10, 0, 0])
  })

  it('самый загруженный день из всех встреч и самый загруженный час', () => {
    expect(heatmapConclusion(cells, 12)).toBe(
      'Чаще всего встречаются в пятницу: 10 из 12 встреч (83 %); самый загруженный час — 10:00, 7 встреч за все дни.',
    )
  })

  it('пустая карта — без деления на ноль', () => {
    expect(heatmapConclusion(cells.map((row) => row.map(() => 0)), 0)).toBe('Проведённых встреч нет.')
  })
})
