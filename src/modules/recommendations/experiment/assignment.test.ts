import { describe, expect, it } from 'vitest'
import {
  assignArm,
  assignmentUniform,
  effectiveControlShare,
  isControlEligible,
  periodKey,
  type ExperimentSettings,
} from './assignment'

/**
 * Назначение группы (решение 126): детерминизм, доля контроля на больших выборках,
 * что исключается из эксперимента и выключатель. Формулы и мотивация — см.
 * docs/RECOMMENDATIONS_EXPERIMENT.md и docs/TECHNICAL_DECISIONS.md, раздел 126.
 */

const SETTINGS: ExperimentSettings = {
  enabled: true,
  controlShare: 0.1,
  horizonDays: 30,
  salt: 'test-salt',
  neverControlRules: ['stage.overdue', 'cooperation.no-product'],
}

describe('assignmentUniform и assignArm — детерминизм', () => {
  it('один и тот же ключ и соль всегда дают одно и то же число', () => {
    const key = { ruleType: 'cooperation.stalled', entityType: 'Cooperation', entityId: 'coop-1', periodKey: '30d-1' }
    const first = assignmentUniform(key, 'salt-a')
    for (let i = 0; i < 20; i += 1) {
      expect(assignmentUniform(key, 'salt-a')).toBe(first)
    }
  })

  it('число лежит в [0, 1)', () => {
    for (let i = 0; i < 500; i += 1) {
      const u = assignmentUniform(
        { ruleType: 'r', entityType: 'Cooperation', entityId: `e-${i}`, periodKey: '30d-1' },
        'salt',
      )
      expect(u).toBeGreaterThanOrEqual(0)
      expect(u).toBeLessThan(1)
    }
  })

  it('другая соль — другое число (другой эксперимент)', () => {
    const key = { ruleType: 'r', entityType: 'Cooperation', entityId: 'e-1', periodKey: '30d-1' }
    expect(assignmentUniform(key, 'salt-a')).not.toBe(assignmentUniform(key, 'salt-b'))
  })

  it('assignArm по одному и тому же сигналу всегда возвращает одну группу, независимо от порядка вызовов', () => {
    const keys = Array.from({ length: 200 }, (_, i) => ({
      ruleType: 'cooperation.stalled',
      entityType: 'Cooperation',
      entityId: `coop-${i}`,
      periodKey: '30d-1',
    }))
    const traits = { priority: 'MEDIUM' as const }
    const first = keys.map((key) => assignArm(key, traits, 'none', SETTINGS).arm)
    // В обратном порядке — тот же результат на каждый ключ: назначение не зависит от порядка обработки.
    const second = [...keys].reverse().map((key) => assignArm(key, traits, 'none', SETTINGS).arm)
    second.reverse()
    expect(second).toEqual(first)
  })
})

describe('доля контроля на большой выборке ключей', () => {
  it('на 10 000 разных ключей доля control ≈ c с точностью ±1,5 п.п.', () => {
    const n = 10_000
    let controls = 0
    for (let i = 0; i < n; i += 1) {
      const key = { ruleType: 'cooperation.stalled', entityType: 'Cooperation', entityId: `coop-${i}`, periodKey: '30d-1' }
      const { arm } = assignArm(key, { priority: 'MEDIUM' }, 'none', SETTINGS)
      if (arm === 'control') controls += 1
    }
    const share = controls / n
    expect(Math.abs(share - SETTINGS.controlShare)).toBeLessThanOrEqual(0.015)
  })

  it('доля не зависит от того, в каком поле меняется id (разные типы объектов)', () => {
    const n = 10_000
    let controls = 0
    for (let i = 0; i < n; i += 1) {
      const key = { ruleType: 'program.missing-metrics', entityType: 'EducationalProgram', entityId: `prog-${i}`, periodKey: '30d-7' }
      const { arm } = assignArm(key, { priority: 'LOW' }, 'none', SETTINGS)
      if (arm === 'control') controls += 1
    }
    expect(Math.abs(controls / n - SETTINGS.controlShare)).toBeLessThanOrEqual(0.015)
  })
})

describe('effectiveControlShare — потолок и некорректные значения', () => {
  it('доля выше потолка обрезается', () => {
    expect(effectiveControlShare(0.9, 0.25)).toBe(0.25)
  })
  it('отрицательная или нечисловая доля — 0 (эксперимент фактически выключен)', () => {
    expect(effectiveControlShare(-0.1, 0.25)).toBe(0)
    expect(effectiveControlShare(Number.NaN, 0.25)).toBe(0)
    expect(effectiveControlShare(0, 0.25)).toBe(0)
  })
  it('доля в пределах потолка не меняется', () => {
    expect(effectiveControlShare(0.1, 0.25)).toBe(0.1)
  })
})

describe('periodKey — окно назначения', () => {
  it('одна и та же дата и окно — один и тот же период', () => {
    const at = new Date('2026-09-26T10:00:00.000Z')
    expect(periodKey(at, 30)).toBe(periodKey(at, 30))
  })
  it('даты в одном окне из H дней получают один период, за его пределами — другой', () => {
    const start = new Date('2026-01-01T00:00:00.000Z')
    const sameWindow = new Date(start.getTime() + 5 * 24 * 60 * 60 * 1000)
    const nextWindow = new Date(start.getTime() + 31 * 24 * 60 * 60 * 1000)
    expect(periodKey(sameWindow, 30)).toBe(periodKey(start, 30))
    expect(periodKey(nextWindow, 30)).not.toBe(periodKey(start, 30))
  })
})

describe('isControlEligible — этическая граница эксперимента', () => {
  it('правило из neverControlRules никогда не уходит в контроль', () => {
    expect(
      isControlEligible({ ruleType: 'stage.overdue' }, { priority: 'MEDIUM' }, SETTINGS),
    ).toBe(false)
    expect(
      isControlEligible({ ruleType: 'cooperation.no-product' }, { priority: 'LOW' }, SETTINGS),
    ).toBe(false)
  })

  it('критичный приоритет никогда не уходит в контроль, каким бы ни было правило', () => {
    expect(
      isControlEligible({ ruleType: 'cooperation.stalled' }, { priority: 'CRITICAL' }, SETTINGS),
    ).toBe(false)
  })

  it('застой на этапе — контрольной точке не уходит в контроль', () => {
    expect(
      isControlEligible(
        { ruleType: 'cooperation.stalled' },
        { priority: 'MEDIUM', stageNumber: 6 },
        SETTINGS,
      ),
    ).toBe(false)
  })

  it('застой на обычном этапе (не контрольная точка) допустим для контроля', () => {
    expect(
      isControlEligible(
        { ruleType: 'cooperation.stalled' },
        { priority: 'MEDIUM', stageNumber: 3 },
        SETTINGS,
      ),
    ).toBe(true)
  })

  it('прочие правила и приоритеты допустимы для контроля', () => {
    expect(
      isControlEligible({ ruleType: 'program.missing-metrics' }, { priority: 'HIGH' }, SETTINGS),
    ).toBe(true)
  })
})

describe('assignArm — выключатель и предыдущее состояние рекомендации', () => {
  const key = { ruleType: 'cooperation.stalled', entityType: 'Cooperation', entityId: 'coop-1', periodKey: '30d-1' }
  const traits = { priority: 'MEDIUM' as const }

  it('эксперимент выключен — всегда treatment, но с explicit-меткой в журнале', () => {
    const off: ExperimentSettings = { ...SETTINGS, enabled: false }
    expect(assignArm(key, traits, 'none', off)).toEqual({ arm: 'treatment', assignedBy: 'experiment-off' })
  })

  it('доля контроля 0 — тоже фактически выключено', () => {
    const zero: ExperimentSettings = { ...SETTINGS, controlShare: 0 }
    expect(assignArm(key, traits, 'none', zero)).toEqual({ arm: 'treatment', assignedBy: 'experiment-off' })
  })

  it('правило не годится для контроля — treatment с меткой excluded-rule', () => {
    const overdueKey = { ...key, ruleType: 'stage.overdue' }
    expect(assignArm(overdueKey, traits, 'none', SETTINGS)).toEqual({
      arm: 'treatment',
      assignedBy: 'excluded-rule',
    })
  })

  it('рекомендация уже открыта, отклонена или закрыта без переоткрытия — не разыгрывается заново', () => {
    expect(assignArm(key, traits, 'open', SETTINGS).assignedBy).toBe('already-shown')
    expect(assignArm(key, traits, 'dismissed', SETTINGS).assignedBy).toBe('dismissed')
    expect(assignArm(key, traits, 'resolved', SETTINGS).assignedBy).toBe('resolved')
    for (const prior of ['open', 'dismissed', 'resolved'] as const) {
      expect(assignArm(key, traits, prior, SETTINGS).arm).toBe('treatment')
    }
  })

  it('нет предыдущей рекомендации или она переоткрываема — участвует в розыгрыше по хешу', () => {
    expect(assignArm(key, traits, 'none', SETTINGS).assignedBy).toBe('hash')
    expect(assignArm(key, traits, 'reopenable', SETTINGS).assignedBy).toBe('hash')
  })
})
