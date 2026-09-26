import { describe, expect, it } from 'vitest'
import { computeDrift, staleReasons } from './forecast-explain'
import { predictModel, type StoredCoefficients } from './forecast-model'
import { logit, psiBins, sigmoid } from './forecast-math'
import { FEATURE_KEYS, type FeatureKey, type FeatureVector } from './forecast-features'

const ZERO_VECTOR: FeatureVector = Object.fromEntries(FEATURE_KEYS.map((key) => [key, 0])) as FeatureVector

function stat(mean: number, std: number) {
  return { mean, std }
}

describe('объяснение прогноза: вклады складываются в логит', () => {
  const coefficients: StoredCoefficients = {
    intercept: -0.3,
    weights: Object.fromEntries(FEATURE_KEYS.map((key, i) => [key, (i + 1) * 0.1])) as Record<FeatureKey, number>,
  }
  const stats = Object.fromEntries(FEATURE_KEYS.map((key, i) => [key, stat(i, 1 + i * 0.2)])) as Record<
    FeatureKey,
    { mean: number; std: number }
  >
  const features: FeatureVector = Object.fromEntries(FEATURE_KEYS.map((key, i) => [key, i + (i % 3)])) as FeatureVector

  it('сумма вкладов признаков = логит − свободный член', () => {
    const prediction = predictModel(coefficients, stats, features)
    const sumOfContributions = FEATURE_KEYS.reduce((sum, key) => sum + prediction.contributions[key], 0)
    expect(sumOfContributions).toBeCloseTo(prediction.logit - coefficients.intercept, 10)
  })

  it('вероятность — это sigmoid(логита), логит — обратное преобразование вероятности', () => {
    const prediction = predictModel(coefficients, stats, features)
    expect(prediction.probability).toBeCloseTo(sigmoid(prediction.logit), 10)
    expect(logit(prediction.probability)).toBeCloseTo(prediction.logit, 8)
  })

  it('нулевой признак (std = 0) не вносит вклад — сравнивать ему не с чем', () => {
    const flatStats = Object.fromEntries(FEATURE_KEYS.map((key) => [key, stat(5, 0)])) as Record<
      FeatureKey,
      { mean: number; std: number }
    >
    const prediction = predictModel(coefficients, flatStats, ZERO_VECTOR)
    for (const key of FEATURE_KEYS) expect(prediction.contributions[key]).toBe(0)
    expect(prediction.logit).toBeCloseTo(coefficients.intercept, 10)
  })
})

describe('сдвиг признаков (PSI) для статуса «прогноз устарел»', () => {
  const training = Array.from({ length: 100 }, (_, i) => i)
  const bins = { psi: psiBins(training, 10), mean: 50, std: 29, quantiles: [] as number[] }
  const features = Object.fromEntries(FEATURE_KEYS.map((key) => [key, bins])) as Record<FeatureKey, typeof bins>

  it('меньше порога связок — сдвиг не считается (не «сдвига нет», а «не считали»)', () => {
    const few = Array.from({ length: 5 }, () => ({ ...ZERO_VECTOR, stageNumber: 3 }))
    const drift = computeDrift(features, few, 20)
    expect(drift.psi).toBeNull()
    expect(drift.sample).toBe(5)
  })

  it('текущие связки того же распределения — PSI около нуля по каждому признаку', () => {
    const current = training.map((value) => Object.fromEntries(FEATURE_KEYS.map((key) => [key, value])) as FeatureVector)
    const drift = computeDrift(features, current, 20)
    expect(drift.psi).not.toBeNull()
    for (const key of FEATURE_KEYS) expect(drift.psi![key]).toBeLessThan(0.05)
  })

  it('сильно сдвинутые текущие значения — PSI выше порога 0,25', () => {
    const shifted = Array.from({ length: 50 }, () => Object.fromEntries(FEATURE_KEYS.map((key) => [key, 999])) as FeatureVector)
    const drift = computeDrift(features, shifted, 20)
    for (const key of FEATURE_KEYS) expect(drift.psi![key]).toBeGreaterThan(0.25)
  })
})

describe('устаревание модели', () => {
  it('обучена давно — устарела по возрасту', () => {
    const trainedAt = new Date('2026-01-01T00:00:00.000Z')
    const now = new Date('2026-02-01T00:00:00.000Z') // 31 день — больше порога 14
    expect(staleReasons(trainedAt, now, null).length).toBeGreaterThan(0)
  })

  it('обучена вчера, сдвига нет — не устарела', () => {
    const trainedAt = new Date('2026-01-01T00:00:00.000Z')
    const now = new Date('2026-01-02T00:00:00.000Z')
    expect(staleReasons(trainedAt, now, { psi: { stageNumber: 0.01 }, sample: 40 })).toEqual([])
  })

  it('сильный сдвиг признака — устарела даже свежая модель', () => {
    const trainedAt = new Date('2026-01-01T00:00:00.000Z')
    const now = new Date('2026-01-02T00:00:00.000Z')
    const reasons = staleReasons(trainedAt, now, { psi: { daysSinceActivity: 0.4 }, sample: 40 })
    expect(reasons.length).toBe(1)
    expect(reasons[0]).toContain('Дней с последней активности')
  })
})
