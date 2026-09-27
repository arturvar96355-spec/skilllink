import { describe, expect, it } from 'vitest'
import type { CooperationForecastDto } from '@/shared/contracts'
import { chanceLevel, forecastEmpty, forecastHeadline, forecastHelp, howWeCount } from './forecast-view'

const base: CooperationForecastDto = {
  cooperationId: 'c1',
  milestone: { stageNumber: 11, stageTitle: 'Проведение занятий', goal: 'проведения занятий' },
  horizonDays: 90,
  probability: 0.53,
  source: 'baseline',
  status: 'insufficient_data',
  statusLabel: 'Недостаточно данных',
  summary: 'Оценка по правилу: для модели пока мало данных',
  explanation: [],
  notes: [],
  modelVersion: 1,
  trainedAt: null,
  isMock: true,
  generatedAt: '2026-09-27T00:00:00.000Z',
}

/** Слова, которых эксперт не должен видеть на виду (решение 211). */
const JARGON = /AUC|Brier|калибров|BASELINE|модел|ворот|правил/i

describe('подача прогноза (решение 211)', () => {
  it('заголовок — вопрос человеческими словами', () => {
    expect(forecastHeadline(base.milestone!, 90)).toBe('Шансы дойти до начала занятий за 90 дней')
    expect(forecastHeadline({ stageNumber: 6, stageTitle: 'Подписание документов', goal: 'подписанного договора' }, 60)).toBe(
      'Шансы дойти до договора за 60 дней',
    )
    expect(forecastHeadline({ stageNumber: 9, stageTitle: 'Обучение преподавателей', goal: 'x' }, 31)).toBe(
      'Шансы дойти до этапа 9 «Обучение преподавателей» за 31 день',
    )
  })

  it('шансы словами по доле', () => {
    expect(chanceLevel(0.8)).toBe('high')
    expect(chanceLevel(0.65)).toBe('high')
    expect(chanceLevel(0.53)).toBe('medium')
    expect(chanceLevel(0.35)).toBe('medium')
    expect(chanceLevel(0.1)).toBe('low')
  })

  it('«как считаем» соответствует источнику числа', () => {
    expect(howWeCount('baseline')).toMatch(/как часто связки на этом этапе/)
    expect(howWeCount('model')).toMatch(/встречи, дни без активности/)
  })

  it('на виду нет технических слов', () => {
    for (const source of ['baseline', 'model'] as const) {
      expect(howWeCount(source)).not.toMatch(JARGON)
      for (const level of ['high', 'medium', 'low'] as const) {
        expect(forecastHelp({ ...base, source }, level)).not.toMatch(JARGON)
      }
    }
    for (const status of ['insufficient_data', 'reached', 'not_applicable'] as const) {
      const empty = forecastEmpty({ ...base, status, probability: null })
      expect(empty.title + empty.description).not.toMatch(JARGON)
    }
  })

  it('при низких шансах подсказка говорит, что делать', () => {
    expect(forecastHelp(base, 'low')).toMatch(/Что делать: шансы низкие/)
    expect(forecastHelp({ ...base, source: 'model' }, 'low')).toMatch(/встреча с вузом/)
  })
})
