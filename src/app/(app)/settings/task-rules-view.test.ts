import { describe, expect, it } from 'vitest'
import type { CalculationParameterDto, RuleStatsDto } from '@/shared/contracts'
import { outcomesText, ruleThresholds, TASK_RULES, usefulnessConclusion, usefulnessRows } from './task-rules-view'

function param(configKey: string, value: CalculationParameterDto['value'], unit: CalculationParameterDto['unit'], isTemporary = true): CalculationParameterDto {
  return { configKey, label: configKey, hint: null, value, unit, valueLabel: null, isTemporary }
}

const PARAMS = [
  param('RECOMMENDATION_RULES.overdueHighDays', 7, 'days'),
  param('RECOMMENDATION_RULES.overdueCriticalDays', 21, 'days'),
  param('RECOMMENDATION_RULES.productRequiredFromStage', 4, 'stage'),
  param('RECOMMENDATION_RULES.stalledDays', 14, 'days'),
  param('STALLED_THRESHOLD.fromData', true, 'flag'),
  param('SKILL_GAP.demandThreshold', 0.6, 'share', false),
]

function rule(overrides: Partial<RuleStatsDto> = {}): RuleStatsDto {
  return {
    ruleKey: 'stage.overdue',
    ruleLabel: 'Просроченный этап',
    enabled: true,
    outcomes: { total: 15, open: 4, taken: 6, dismissed: 5 },
    scopeType: 'global',
    scopeId: 'all',
    scopeLabel: null,
    p: 0.62,
    pSource: 'local',
    ci90: [0.41, 0.8],
    trials: 20,
    successes: 12,
    trialsEff: 12,
    successesEff: 7,
    updatedAt: null,
    scopes: [],
    ...overrides,
  }
}

describe('правила списка задач (решение 218)', () => {
  it('у каждого из пяти правил — фраза «что ищет»; у правила без порога — почему', () => {
    for (const key of ['stage.overdue', 'cooperation.stalled', 'cooperation.no-product', 'program.missing-metrics', 'skill.critical-gap-with-product']) {
      expect(TASK_RULES[key]?.seeks.length, key).toBeGreaterThan(20)
    }
    expect(TASK_RULES['program.missing-metrics']?.noThreshold).toContain('Порога нет')
  })

  it('порог — фразами из параметров расчётов, с пометкой «черновое»', () => {
    expect(ruleThresholds('stage.overdue', PARAMS)).toEqual([
      { text: 'высокий приоритет с 7 дн. просрочки', isTemporary: true },
      { text: 'критичный с 21 дн.', isTemporary: true },
    ])
    expect(ruleThresholds('cooperation.no-product', PARAMS)[0]?.text).toBe('продукт нужен с 4-го этапа')
    expect(ruleThresholds('cooperation.stalled', PARAMS).map((part) => part.text)).toEqual([
      'без движения дольше 14 дн.',
      'где истории этапа хватает — по тому, сколько он обычно длится',
    ])
    // Параметра нет в ответе — часть порога пропускается, а не показывается пустой.
    expect(ruleThresholds('skill.critical-gap-with-product', PARAMS)).toEqual([
      { text: 'спрос рынка не ниже 60%', isTemporary: false },
    ])
  })

  it('что стало с задачами — числом и долей от всех задач правила', () => {
    expect(outcomesText({ total: 15, open: 4, taken: 6, dismissed: 5 })).toBe(
      'Создало 15 задач: взяли в работу 6 (40%), отклонили 5 (33%), ждут решения 4',
    )
    expect(outcomesText({ total: 0, open: 0, taken: 0, dismissed: 0 })).toBe('Задач ещё не создавало')
  })

  it('полезность: процент на общей шкале, ниже порога — жёлтая, без своих данных — честная пометка', () => {
    const rows = usefulnessRows(
      [rule(), rule({ ruleKey: 'cooperation.stalled', ruleLabel: 'Связка без движения', p: 0.2, ci90: [0.08, 0.36] }), rule({ ruleKey: 'x', ruleLabel: 'Новое', pSource: 'global', p: 0.5 })],
      0.35,
    )
    expect(rows[0]).toMatchObject({ value: 62, valueText: '62%', marker: 35, tone: 'default', note: 'скорее всего 41–80%' })
    expect(rows[1]).toMatchObject({ tone: 'warning', note: 'чаще отклоняют; скорее всего 8–36%' })
    expect(rows[2]?.note).toBe('мало решений — оценка по общему уровню')
  })

  it('вывод одной фразой — из данных', () => {
    expect(
      usefulnessConclusion([rule(), rule({ ruleKey: 'cooperation.stalled', ruleLabel: 'Связка без движения', p: 0.2 })]),
    ).toBe('Полезнее всего задачи правила «Просроченный этап» (62%), реже всего пригождаются — «Связка без движения» (20%).')
    expect(usefulnessConclusion([rule({ pSource: 'global' })])).toContain('пока мало')
  })
})
