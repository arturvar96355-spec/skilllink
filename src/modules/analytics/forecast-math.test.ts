import { describe, expect, it } from 'vitest'
import {
  auc,
  brier,
  calibration,
  fitLogisticGradient,
  fitLogisticNewton,
  logit,
  psi,
  psiBins,
  sigmoid,
} from './forecast-math'

describe('AUC по рангам (Манн — Уитни)', () => {
  it('ручной пример без ничьих', () => {
    // Отсортировано: 0,1(-) 0,35(+) 0,4(-) 0,8(+). Из 4 пар «плюс лучше минуса» — 3: 0,75.
    expect(auc([0.1, 0.4, 0.35, 0.8], [0, 0, 1, 1])).toBeCloseTo(0.75, 10)
  })

  it('ручной пример с ничьёй: одно значение общее у плюса и минуса', () => {
    // Значения 1(-) 2(-) 2(+) 3(+). Ничья 2 против 2 считается за половину.
    // Пары: (2+,1-)=1 (2+,2-)=0,5 (3+,1-)=1 (3+,2-)=1 → 3,5 из 4 → 0,875.
    expect(auc([1, 2, 2, 3], [0, 0, 1, 1])).toBeCloseTo(0.875, 10)
  })

  it('все значения одинаковы — угадывание, 0,5', () => {
    expect(auc([0.5, 0.5, 0.5, 0.5], [0, 1, 0, 1])).toBeCloseTo(0.5, 10)
  })

  it('идеальное разделение — 1; нет одного из классов — null', () => {
    expect(auc([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1])).toBe(1)
    expect(auc([0.1, 0.2, 0.3], [0, 0, 0])).toBeNull()
    expect(auc([0.1, 0.2, 0.3], [1, 1, 1])).toBeNull()
  })
})

describe('Brier score', () => {
  it('средний квадрат ошибки — ручной пример', () => {
    // (0,9-1)²=0,01 (0,1-0)²=0,01 (0,8-1)²=0,04 (0,3-0)²=0,09 → 0,15 / 4 = 0,0375
    expect(brier([0.9, 0.1, 0.8, 0.3], [1, 0, 1, 0])).toBeCloseTo(0.0375, 10)
  })

  it('идеальный прогноз — 0; пустая выборка — null', () => {
    expect(brier([1, 0], [1, 0])).toBe(0)
    expect(brier([], [])).toBeNull()
  })
})

describe('калибровка по корзинам', () => {
  it('пять корзин, последняя включает правый край', () => {
    const bins = calibration([0.05, 0.25, 0.99, 1], [0, 1, 1, 1], 5)
    expect(bins).toHaveLength(5)
    expect(bins[0]).toMatchObject({ from: 0, to: 0.2, count: 1, observedRate: 0 })
    expect(bins[4]).toMatchObject({ count: 2 }) // 0,99 и 1 — оба в последней корзине [0,8; 1]
  })
})

describe('логистическая регрессия — сходимость', () => {
  it('признак без разброса: интерсепт равен logit(доли положительных), вес — ноль', () => {
    // x всегда 0 → предсказание не зависит от веса: минимум и с L2, и без него — вес 0,
    // а интерсепт — обычная логистическая регрессия с одним свободным членом.
    const x = [[0], [0], [0], [0], [0]]
    const y = [1, 1, 1, 0, 0]
    const expectedIntercept = logit(0.6)

    const newton = fitLogisticNewton(x, y, { lambda: 1, maxIterations: 100, tolerance: 1e-12 })
    expect(newton.converged).toBe(true)
    expect(newton.intercept).toBeCloseTo(expectedIntercept, 6)
    expect(newton.weights[0]).toBeCloseTo(0, 6)

    const gradient = fitLogisticGradient(x, y, { lambda: 1, learningRate: 1, iterations: 20_000 })
    expect(gradient.intercept).toBeCloseTo(expectedIntercept, 2)
    expect(gradient.weights[0]).toBeCloseTo(0, 2)
  })

  it('два независимых метода приходят в одну точку на маленьком наборе', () => {
    const x = [[-2], [-1], [0], [1], [2]]
    const y = [0, 0, 0, 1, 1]
    const newton = fitLogisticNewton(x, y, { lambda: 0.5, maxIterations: 100, tolerance: 1e-12 })
    const gradient = fitLogisticGradient(x, y, { lambda: 0.5, learningRate: 0.5, iterations: 50_000 })

    expect(newton.converged).toBe(true)
    expect(gradient.intercept).toBeCloseTo(newton.intercept, 2)
    expect(gradient.weights[0]).toBeCloseTo(newton.weights[0]!, 2)
    // Разделимая по x выборка → положительный вес.
    expect(newton.weights[0]!).toBeGreaterThan(0)
  })
})

describe('сигмоида и логит — взаимно обратны', () => {
  it('sigmoid(logit(p)) = p', () => {
    for (const p of [0.01, 0.2, 0.5, 0.8, 0.99]) {
      expect(sigmoid(logit(p))).toBeCloseTo(p, 8)
    }
  })
})

describe('PSI (Population Stability Index)', () => {
  it('то же распределение — PSI около нуля', () => {
    const training = Array.from({ length: 200 }, (_, i) => i + 1)
    const bins = psiBins(training, 10)
    expect(psi(bins, training)).toBeLessThan(0.02)
  })

  it('сильный сдвиг (все значения в одну корзину) — выше порога 0,25', () => {
    const training = Array.from({ length: 200 }, (_, i) => i + 1)
    const bins = psiBins(training, 10)
    const shifted = Array.from({ length: 50 }, () => 200)
    expect(psi(bins, shifted)).toBeGreaterThan(0.25)
  })
})
