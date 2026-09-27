import { describe, expect, it } from 'vitest'
import { measureShare } from './measure-bars'

describe('measureShare — доля полосы на шкале (решение 215)', () => {
  it('значение делится на правый край и не выходит за 0..1', () => {
    expect(measureShare(38, 77)).toBeCloseTo(38 / 77)
    expect(measureShare(120, 100)).toBe(1)
    expect(measureShare(-5, 100)).toBe(0)
  })

  it('«Нет данных» — не ноль', () => {
    expect(measureShare(null, 100)).toBeNull()
    expect(measureShare(undefined, 100)).toBeNull()
  })

  it('пустая шкала не даёт деления на ноль', () => {
    expect(measureShare(0, 0)).toBe(0)
  })
})
