import { describe, expect, it } from 'vitest'
import { BACKOFF_MAX_MS, BACKOFF_MIN_MS, computeBackoffDelayMs } from './telegram.backoff'

/** Разброс — детерминированный источник случайности вместо Math.random. */
const randomAt = (value: number) => () => value

describe('computeBackoffDelayMs', () => {
  it('первая попытка — около 1 с (с разбросом ±20%)', () => {
    expect(computeBackoffDelayMs(1, randomAt(0.5))).toBe(BACKOFF_MIN_MS)
  })

  it('растёт вдвое на каждый следующий подряд сбой: 1 → 2 → 4 → 8 с (без разброса)', () => {
    expect(computeBackoffDelayMs(1, randomAt(0.5))).toBe(1_000)
    expect(computeBackoffDelayMs(2, randomAt(0.5))).toBe(2_000)
    expect(computeBackoffDelayMs(3, randomAt(0.5))).toBe(4_000)
    expect(computeBackoffDelayMs(4, randomAt(0.5))).toBe(8_000)
  })

  it('не превышает потолок 60 с даже при длинной серии сбоев', () => {
    expect(computeBackoffDelayMs(10, randomAt(0.5))).toBe(BACKOFF_MAX_MS)
    expect(computeBackoffDelayMs(100, randomAt(0.5))).toBe(BACKOFF_MAX_MS)
  })

  it('разброс ±20% от базы, но не выходит за границы [1с; 60с]', () => {
    const base = 8_000 // failureStreak = 4
    expect(computeBackoffDelayMs(4, randomAt(1))).toBe(base + base * 0.2)
    expect(computeBackoffDelayMs(4, randomAt(0))).toBe(base - base * 0.2)

    // На потолке разброс не должен утащить паузу выше 60 с.
    expect(computeBackoffDelayMs(10, randomAt(1))).toBe(BACKOFF_MAX_MS)
    // И у минимальной паузы разброс не должен увести её ниже 1 с.
    expect(computeBackoffDelayMs(1, randomAt(0))).toBe(BACKOFF_MIN_MS)
  })

  it('нулевой и отрицательный номер попытки — как первая попытка', () => {
    expect(computeBackoffDelayMs(0, randomAt(0.5))).toBe(BACKOFF_MIN_MS)
    expect(computeBackoffDelayMs(-3, randomAt(0.5))).toBe(BACKOFF_MIN_MS)
  })
})
