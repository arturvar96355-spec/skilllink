import { describe, expect, it } from 'vitest'
import { heatIntensity } from './heatmap-color'

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
