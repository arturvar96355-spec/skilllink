import { describe, expect, it } from 'vitest'
import type { RecommendationScoreDto } from '@/shared/contracts'
import { partsOf } from './recommendation-score'

function breakdown(overrides: Partial<RecommendationScoreDto> = {}): RecommendationScoreDto {
  return {
    p: 0.647,
    pSource: 'global',
    pLevel: 'global',
    sampling: 'mean',
    trialsEff: 28.4,
    successesEff: 18.7,
    value: 77,
    valueLabel: 'спрос на навык из 100',
    valueAnchor: 50,
    valueScore: 0.606,
    priority: 0.667,
    weights: { rule: 0.5, value: 0.35, priority: 0.15 },
    score: 0.636,
    ...overrides,
  }
}

describe('RecommendationScore: partsOf', () => {
  it('сумма вкладов равна баллу × 100 (решение 119: score = rule·p + value·valueScore + priority·priority)', () => {
    const data = breakdown()
    const expectedScore =
      data.weights.rule * data.p + data.weights.value * data.valueScore + data.weights.priority * data.priority
    const total = partsOf(data).reduce((sum, part) => sum + (part.contribution ?? 0), 0)
    expect(total).toBeCloseTo(expectedScore * 100, 6)
  })

  it('вклады растут вместе со своим фактором при равных весах', () => {
    const low = partsOf(breakdown({ p: 0.1 }))
    const high = partsOf(breakdown({ p: 0.9 }))
    expect(high[0]!.contribution!).toBeGreaterThan(low[0]!.contribution!)
  })

  it('нулевой вес правила даёт нулевой вклад, даже если вероятность высокая', () => {
    const data = breakdown({ p: 0.99, weights: { rule: 0, value: 0.35, priority: 0.15 } })
    expect(partsOf(data)[0]!.contribution).toBe(0)
  })

  it('каждая часть несёт своё исходное значение — для подсказки и разбора', () => {
    const data = breakdown()
    const parts = partsOf(data)
    expect(parts.find((part) => part.key === 'value')!.value).toBe(data.value)
    expect(parts.find((part) => part.key === 'priority')!.value).toBe(data.priority)
  })
})
