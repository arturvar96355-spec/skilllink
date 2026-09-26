import { describe, expect, it } from 'vitest'
import { evaluateGate, trainMilestoneModel } from './forecast-model'
import { FORECAST_MILESTONES } from '@/shared/config/forecast.config'
import { SYNTHETIC_NOW, noiseTimelines, patternTimelines } from './forecast.synthetic'

describe('ворота публикации модели', () => {
  it('снимков на проверке мало — недостаточно данных, даже если AUC хорош', () => {
    const result = evaluateGate({
      trainingOk: true,
      n: 10,
      positives: 5,
      modelAuc: 0.9,
      modelAucLower: 0.7,
      baselineAuc: 0.6,
    })
    expect(result.status).toBe('insufficient_data')
  })

  it('данных достаточно, но модель не лучше правила — baseline_better', () => {
    const result = evaluateGate({
      trainingOk: true,
      n: 100,
      positives: 30,
      modelAuc: 0.61,
      modelAucLower: 0.55,
      baselineAuc: 0.6, // выигрыш 0,01 — меньше порога 0,02
    })
    expect(result.status).toBe('baseline_better')
  })

  it('данных достаточно, модель заметно лучше правила и выше угадывания — published', () => {
    const result = evaluateGate({
      trainingOk: true,
      n: 100,
      positives: 30,
      modelAuc: 0.75,
      modelAucLower: 0.6,
      baselineAuc: 0.6,
    })
    expect(result.status).toBe('published')
  })

  it('нижняя граница AUC не выше угадывания — published не выдаётся даже при формальном выигрыше', () => {
    const result = evaluateGate({
      trainingOk: true,
      n: 100,
      positives: 30,
      modelAuc: 0.65,
      modelAucLower: 0.49,
      baselineAuc: 0.6,
    })
    expect(result.status).toBe('baseline_better')
  })

  it('обучающих снимков не хватило — модель вовсе не обучалась', () => {
    const result = evaluateGate({
      trainingOk: false,
      n: 100,
      positives: 30,
      modelAuc: null,
      modelAucLower: null,
      baselineAuc: 0.6,
    })
    expect(result.status).toBe('insufficient_data')
  })
})

describe('обучение на синтетике: закономерность модель находит, шум — нет', () => {
  const milestone = FORECAST_MILESTONES[0]!

  it('заложенная закономерность: AUC выше 0,75, «дней без активности» — против', () => {
    const timelines = patternTimelines()
    const trained = trainMilestoneModel(timelines, milestone, null, SYNTHETIC_NOW)

    expect(trained.metrics.auc).not.toBeNull()
    expect(trained.metrics.auc as number).toBeGreaterThan(0.75)
    expect(trained.status).toBe('published')
    expect(trained.coefficients).not.toBeNull()
    // Больше дней без активности — реже доходят до подписания: коэффициент отрицательный.
    expect(trained.coefficients!.weights.daysSinceActivity).toBeLessThan(0)
  })

  it('чистый шум: ворота не пропускают модель', () => {
    const timelines = noiseTimelines()
    const trained = trainMilestoneModel(timelines, milestone, null, SYNTHETIC_NOW)

    expect(trained.status).not.toBe('published')
    expect(['insufficient_data', 'baseline_better']).toContain(trained.status)
  })
})
