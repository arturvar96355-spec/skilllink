import { describe, expect, it } from 'vitest'
import { gapBarMetrics } from './gap-bars'

describe('числа полосы дефицита (решение 197)', () => {
  it('навыка нет в программах — дефицит равен всему спросу', () => {
    const result = gapBarMetrics(0.9, 0)
    expect(result.demandPercent).toBeCloseTo(90)
    expect(result.gapPercent).toBeCloseTo(90)
    expect(result.coveredShareOfBar).toBe(0)
  })

  it('покрытие ниже спроса — дефицит - это разность, а не произведение долей', () => {
    // Спрос 0,734 (JavaScript в демо-наборе), покрытие INTERMEDIATE = 0,67:
    // дефицит 0,734 − 0,67 ≈ 0,064, а не 0,734 × 0,67 ≈ 0,49 (старая ошибка).
    const result = gapBarMetrics(0.734, 0.67)
    expect(result.demandPercent).toBeCloseTo(73.4)
    expect(result.gapPercent).toBeCloseTo(6.4, 1)
    // Закрашено должно быть 67 из 73,4 (≈ 91,3 %), а не 67 % полосы.
    expect(result.coveredShareOfBar).toBeCloseTo((67 / 73.4) * 100, 1)
  })

  it('покрытие не ниже спроса — дефицита нет, полоса закрашена целиком', () => {
    const result = gapBarMetrics(0.5, 1)
    expect(result.gapPercent).toBe(0)
    expect(result.coveredShareOfBar).toBe(100)
  })

  it('покрытие больше спроса — запас, не отрицательный дефицит, полоса не растягивается', () => {
    const result = gapBarMetrics(0.3, 0.8)
    expect(result.demandPercent).toBeCloseTo(30)
    expect(result.gapPercent).toBe(0)
    expect(result.coveredShareOfBar).toBe(100)
  })

  it('спроса нет (0) — пустая полоса без деления на ноль', () => {
    const result = gapBarMetrics(0, 0.5)
    expect(result.demandPercent).toBe(0)
    expect(result.gapPercent).toBe(0)
    expect(result.coveredShareOfBar).toBe(0)
  })

  it('значения вне 0..1 приводятся к границам диапазона', () => {
    const result = gapBarMetrics(1.5, -0.2)
    expect(result.demandPercent).toBe(100)
    expect(result.gapPercent).toBe(100)
    expect(result.coveredShareOfBar).toBe(0)
  })
})
