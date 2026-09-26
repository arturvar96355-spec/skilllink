import { describe, expect, it } from 'vitest'
import {
  momentsOf,
  newcombeDifference,
  normalQuantile,
  regularizedBeta,
  sequentialTest,
  studentQuantile,
  varianceOf,
  welchInterval,
  wilsonInterval,
} from './stats'

/**
 * Статистика проверки рекомендаций (решение 126): квантили, интервалы для долей
 * (Уилсон, 10 Ньюкомба) и для средних (Уэлч), последовательная проверка Вальда.
 * Ручные примеры сверены независимым расчётом — docs/TECHNICAL_DECISIONS.md, раздел 126.
 */

const Z95 = 1.959963985

describe('normalQuantile', () => {
  it('Φ⁻¹(0,975) — известное табличное значение 1,959964', () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5)
  })
  it('симметрична относительно 0,5', () => {
    expect(normalQuantile(0.1)).toBeCloseTo(-normalQuantile(0.9), 9)
  })
  it('Φ⁻¹(0,5) = 0', () => {
    expect(normalQuantile(0.5)).toBeCloseTo(0, 6)
  })
  it('за пределами (0, 1) — ошибка', () => {
    expect(() => normalQuantile(0)).toThrow()
    expect(() => normalQuantile(1)).toThrow()
  })
})

describe('studentQuantile', () => {
  it('df = 10, p = 0,975 — табличное значение ≈ 2,228', () => {
    expect(studentQuantile(0.975, 10)).toBeCloseTo(2.228, 2)
  })
  it('df = 1, p = 0,975 — табличное значение ≈ 12,706', () => {
    expect(studentQuantile(0.975, 1)).toBeCloseTo(12.706, 2)
  })
  it('при большом df приближается к нормальному квантилю', () => {
    expect(studentQuantile(0.975, 100_000)).toBeCloseTo(normalQuantile(0.975), 2)
  })
  it('p = 0,5 — квантиль 0 при любом df', () => {
    expect(studentQuantile(0.5, 5)).toBeCloseTo(0, 6)
  })
})

describe('regularizedBeta', () => {
  it('на краях 0 и 1', () => {
    expect(regularizedBeta(0, 2, 3)).toBe(0)
    expect(regularizedBeta(1, 2, 3)).toBe(1)
  })
  it('I_0,5(1, 1) = 0,5 — совпадает с равномерным распределением', () => {
    expect(regularizedBeta(0.5, 1, 1)).toBeCloseTo(0.5, 9)
  })
})

describe('wilsonInterval — крайние случаи и ручной пример', () => {
  it('n = 0 — данных нет, весь отрезок 0…1', () => {
    expect(wilsonInterval(0, 0, Z95)).toEqual({ low: 0, high: 1 })
  })
  it('0 успехов из n — нижняя граница ровно 0, а не отрицательное число', () => {
    const { low, high } = wilsonInterval(0, 20, Z95)
    expect(low).toBe(0)
    expect(high).toBeCloseTo(0.16113, 4)
  })
  it('n успехов из n — верхняя граница ровно 1', () => {
    const { low, high } = wilsonInterval(20, 20, Z95)
    expect(high).toBe(1)
    expect(low).toBeCloseTo(0.83887, 4)
  })
  it('8 из 20 — сверено независимым расчётом', () => {
    const { low, high } = wilsonInterval(8, 20, Z95)
    expect(low).toBeCloseTo(0.21881, 4)
    expect(high).toBeCloseTo(0.61342, 4)
  })
  it('интервал всегда внутри [0, 1] и накрывает точечную оценку', () => {
    for (const [s, n] of [[3, 7], [1, 1], [0, 1], [50, 50]] as const) {
      const { low, high } = wilsonInterval(s, n, Z95)
      expect(low).toBeGreaterThanOrEqual(0)
      expect(high).toBeLessThanOrEqual(1)
      expect(low).toBeLessThanOrEqual(s / n)
      expect(high).toBeGreaterThanOrEqual(s / n)
    }
  })
})

describe('newcombeDifference — метод 10 Ньюкомба', () => {
  it('40/100 против 25/100 — сверено независимым расчётом', () => {
    const { low, high } = newcombeDifference(40, 100, 25, 100, Z95)
    expect(low).toBeCloseTo(0.02013, 3)
    expect(high).toBeCloseTo(0.27313, 3)
  })
  it('одинаковые доли в обеих группах — интервал симметричен относительно 0', () => {
    const { low, high } = newcombeDifference(0, 30, 0, 30, Z95)
    expect(low).toBeCloseTo(-0.11351, 3)
    expect(high).toBeCloseTo(0.11351, 3)
    expect(low).toBeCloseTo(-high, 9)
  })
  it('интервал не выходит за [-1, 1]', () => {
    const { low, high } = newcombeDifference(0, 5, 5, 5, Z95)
    expect(low).toBeGreaterThanOrEqual(-1)
    expect(high).toBeLessThanOrEqual(1)
  })
  it('весь интервал выше нуля — treatment заметно лучше контроля на больших числах', () => {
    const { low } = newcombeDifference(600, 1000, 300, 1000, Z95)
    expect(low).toBeGreaterThan(0)
  })
})

describe('momentsOf и varianceOf', () => {
  it('пустая выборка — n = 0, дисперсия NaN', () => {
    const m = momentsOf([])
    expect(m).toEqual({ n: 0, sum: 0, sumSquares: 0 })
    expect(varianceOf(m)).toBeNaN()
  })
  it('одно значение — дисперсию не оценить', () => {
    expect(varianceOf(momentsOf([5]))).toBeNaN()
  })
  it('известная выборка — несмещённая дисперсия совпадает с ручным расчётом', () => {
    // [2, 4, 4, 4, 5, 5, 7, 9] — классический пример, дисперсия (несмещённая) = 4,571428…
    const m = momentsOf([2, 4, 4, 4, 5, 5, 7, 9])
    expect(varianceOf(m)).toBeCloseTo(4.571428571, 6)
  })
  it('дисперсия не уходит в отрицательную область на вырожденной выборке', () => {
    const m = momentsOf([3, 3, 3, 3])
    expect(varianceOf(m)).toBe(0)
  })
})

describe('welchInterval', () => {
  it('меньше двух значений в группе — null', () => {
    expect(welchInterval(momentsOf([1]), momentsOf([1, 2, 3]), 0.95)).toBeNull()
    expect(welchInterval(momentsOf([]), momentsOf([1, 2, 3]), 0.95)).toBeNull()
  })
  it('нулевая дисперсия в обеих группах — интервал схлопывается в точку', () => {
    const result = welchInterval(momentsOf([5, 5, 5]), momentsOf([3, 3, 3]), 0.95)
    expect(result).not.toBeNull()
    expect(result!.diff).toBeCloseTo(2, 9)
    expect(result!.ci.low).toBeCloseTo(2, 9)
    expect(result!.ci.high).toBeCloseTo(2, 9)
  })
  it('разность средних и её знак совпадают с ручным расчётом', () => {
    // treatment быстрее (меньше дней) — разность отрицательная
    const treatment = momentsOf([10, 12, 14, 11, 13, 9, 15, 10, 12, 13])
    const control = momentsOf([20, 18, 22, 19, 21, 17, 23, 20, 18, 19, 21, 20])
    const result = welchInterval(treatment, control, 0.95)
    expect(result).not.toBeNull()
    expect(result!.diff).toBeLessThan(0)
    expect(result!.ci.high).toBeLessThan(0) // весь интервал ниже 0 — уверенно быстрее
    expect(result!.df).toBeGreaterThan(0)
  })
})

describe('sequentialTest — SPRT Вальда', () => {
  const options = { controlShare: 0.1, relativeLift: 0.3, alpha: 0.05, beta: 0.2 }

  it('пороги — ln((1-β)/α) и ln(β/(1-α)) при α=0,05, β=0,2', () => {
    const { upper, lower } = sequentialTest([], options)
    expect(upper).toBeCloseTo(Math.log(0.8 / 0.05), 6)
    expect(lower).toBeCloseTo(Math.log(0.2 / 0.95), 6)
  })

  it('без успехов — решения нет, продолжать', () => {
    expect(sequentialTest([], options).decision).toBe('continue')
  })

  it('успехи почти все из treatment (заметно больше доли q₁ при заложенном приросте) — решение «прирост есть»', () => {
    const arms: Array<'treatment' | 'control'> = []
    for (let i = 0; i < 200; i += 1) arms.push(i % 50 === 0 ? 'control' : 'treatment')
    const result = sequentialTest(arms, options)
    expect(result.decision).toBe('lift')
    expect(result.conversions).toBeLessThanOrEqual(arms.length)
  })

  it('успехи ровно в пропорции без эффекта (1 − c из treatment) — на достаточном числе решение «прироста нет»', () => {
    const arms: Array<'treatment' | 'control'> = []
    for (let i = 0; i < 500; i += 1) arms.push(i % 10 === 0 ? 'control' : 'treatment')
    const result = sequentialTest(arms, options)
    expect(result.decision).toBe('no-lift')
  })

  it('той же пропорции, но мало данных, — решения ещё нет', () => {
    const arms: Array<'treatment' | 'control'> = []
    for (let i = 0; i < 200; i += 1) arms.push(i % 10 === 0 ? 'control' : 'treatment')
    expect(sequentialTest(arms, options).decision).toBe('continue')
  })

  it('доля контроля 0 или 1 — вырожденный случай, решения нет', () => {
    expect(sequentialTest(['treatment'], { ...options, controlShare: 0 }).decision).toBe('continue')
    expect(sequentialTest(['treatment'], { ...options, controlShare: 1 }).decision).toBe('continue')
  })
})
