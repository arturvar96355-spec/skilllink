import { describe, expect, it } from 'vitest'
import { buildExperimentReport, compareArms, experimentStatus, type ReportSettings, type ReportSignal } from './report'
import type { Outcome } from './outcome'

/**
 * Отчёт эксперимента (решение 126): статусы по объёму и интервалу, принцип
 * «по назначению» (intention-to-treat) — знаменатель считается по всем назначенным,
 * а не только по показанным или выполненным рекомендациям.
 */

const SETTINGS: ReportSettings = {
  enabled: true,
  controlShare: 0.1,
  horizonDays: 30,
  minControlForVerdict: 30,
  confidenceLevel: 0.95,
  sequentialAlpha: 0.05,
  sequentialBeta: 0.2,
  sequentialRelativeLift: 0.3,
  neverControlRules: ['stage.overdue'],
}

const NOW = new Date('2026-09-26T00:00:00.000Z')

function outcome(state: Outcome['state'], days: number | null = null): Outcome {
  return { state, days, event: state === 'success' ? 'stage-advance' : null, at: days !== null ? new Date(NOW.getTime() + days * 86_400_000) : null }
}

function signal(overrides: Partial<ReportSignal> & { arm: ReportSignal['arm'] }): ReportSignal {
  return {
    ruleType: 'cooperation.stalled',
    assignedBy: 'hash',
    firedAt: NOW,
    outcome: outcome('pending'),
    controlShare: 0.1,
    ...overrides,
  }
}

describe('experimentStatus', () => {
  it('меньше порога исходов хотя бы в одной группе — мало данных', () => {
    expect(experimentStatus(50, 10, { low: 0.1, high: 0.2 }, 30)).toBe('insufficient-data')
    expect(experimentStatus(10, 50, { low: 0.1, high: 0.2 }, 30)).toBe('insufficient-data')
  })
  it('интервала нет (нет одной из групп) — мало данных', () => {
    expect(experimentStatus(50, 50, null, 30)).toBe('insufficient-data')
  })
  it('интервал содержит 0 — прирост не доказан', () => {
    expect(experimentStatus(50, 50, { low: -0.05, high: 0.1 }, 30)).toBe('not-proven')
  })
  it('весь интервал выше 0 — прирост есть', () => {
    expect(experimentStatus(50, 50, { low: 0.01, high: 0.2 }, 30)).toBe('lift')
  })
  it('весь интервал ниже 0 — с рекомендацией хуже', () => {
    expect(experimentStatus(50, 50, { low: -0.2, high: -0.01 }, 30)).toBe('negative')
  })
})

describe('compareArms — принцип «по назначению» (ITT)', () => {
  it('невыполненная рекомендация (исход failure) в treatment всё равно входит в знаменатель', () => {
    const signals: ReportSignal[] = [
      // Показана, но связка не сдвинулась за окно — рекомендацию проигнорировали или не помогла.
      signal({ arm: 'treatment', outcome: outcome('failure') }),
      signal({ arm: 'treatment', outcome: outcome('success', 5) }),
      signal({ arm: 'control', outcome: outcome('failure') }),
    ]
    const stats = compareArms(signals, SETTINGS)
    // Знаменатель treatment — обе записи, а не только успешную.
    expect(stats.nTreatment).toBe(2)
    expect(stats.successesTreatment).toBe(1)
    expect(stats.convT).toBeCloseTo(0.5, 9)
  })

  it('сигналы с исходом pending не входят ни в числитель, ни в знаменатель', () => {
    const signals: ReportSignal[] = [
      signal({ arm: 'treatment', outcome: outcome('pending') }),
      signal({ arm: 'treatment', outcome: outcome('success', 2) }),
    ]
    const stats = compareArms(signals, SETTINGS)
    expect(stats.nTreatment).toBe(1)
    expect(stats.pendingTreatment).toBe(1)
  })

  it('сигналы, назначенные не по хешу (excluded-rule, already-shown, …), не входят в сравнение', () => {
    const signals: ReportSignal[] = [
      signal({ arm: 'treatment', assignedBy: 'excluded-rule', outcome: outcome('success', 1) }),
      signal({ arm: 'treatment', assignedBy: 'already-shown', outcome: outcome('success', 1) }),
      signal({ arm: 'treatment', assignedBy: 'hash', outcome: outcome('success', 1) }),
    ]
    const stats = compareArms(signals, SETTINGS)
    expect(stats.nTreatment).toBe(1)
  })

  it('дни до перехода: неудача засчитывается как horizonDays, а не выпадает из среднего', () => {
    const signals: ReportSignal[] = [
      signal({ arm: 'treatment', outcome: outcome('success', 5) }),
      signal({ arm: 'treatment', outcome: outcome('failure') }),
      signal({ arm: 'control', outcome: outcome('failure') }),
      signal({ arm: 'control', outcome: outcome('failure') }),
    ]
    const stats = compareArms(signals, SETTINGS)
    // Среднее treatment = (5 + 30) / 2 = 17.5, а не 5 (если бы неудачи выбрасывались).
    expect(stats.days?.meanTreatment).toBeCloseTo(17.5, 6)
    expect(stats.days?.meanControl).toBeCloseTo(30, 6)
  })

  it('нет сигналов вообще — доли и интервал null, а не деление на 0', () => {
    const stats = compareArms([], SETTINGS)
    expect(stats.convT).toBeNull()
    expect(stats.convC).toBeNull()
    expect(stats.ci).toBeNull()
    expect(stats.status).toBe('insufficient-data')
  })
})

describe('buildExperimentReport', () => {
  it('выключенный эксперимент — предупреждение в отчёте', () => {
    const report = buildExperimentReport([], { ...SETTINGS, enabled: false }, NOW)
    expect(report.enabled).toBe(false)
    expect(report.warnings.some((w) => w.includes('выключен'))).toBe(true)
  })

  it('смена доли контроля по ходу эксперимента — тоже предупреждение', () => {
    const signals: ReportSignal[] = [
      signal({ arm: 'treatment', controlShare: 0.1, outcome: outcome('success', 1) }),
      signal({ arm: 'control', controlShare: 0.2, outcome: outcome('failure') }),
    ]
    const report = buildExperimentReport(signals, SETTINGS, NOW)
    expect(report.warnings.some((w) => w.toLowerCase().includes('доля контроля'))).toBe(true)
  })

  it('каждое известное правило попадает в разбивку, даже без единого сигнала', () => {
    const report = buildExperimentReport([], SETTINGS, NOW)
    expect(report.rules.some((r) => r.ruleType === 'cooperation.stalled')).toBe(true)
  })

  it('never-control правило помечено как недопустимое для контроля', () => {
    const report = buildExperimentReport([], SETTINGS, NOW)
    const overdue = report.rules.find((r) => r.ruleType === 'stage.overdue')
    expect(overdue?.controlEligible).toBe(false)
    const stalled = report.rules.find((r) => r.ruleType === 'cooperation.stalled')
    expect(stalled?.controlEligible).toBe(true)
  })

  it('journal считает по способу назначения, а не только по хешу', () => {
    const signals: ReportSignal[] = [
      signal({ arm: 'treatment', assignedBy: 'hash', outcome: outcome('success', 1) }),
      signal({ arm: 'treatment', assignedBy: 'excluded-rule', outcome: outcome('success', 1) }),
      signal({ arm: 'treatment', assignedBy: 'excluded-rule', outcome: outcome('success', 1) }),
    ]
    const report = buildExperimentReport(signals, SETTINGS, NOW)
    expect(report.journal.total).toBe(3)
    expect(report.journal.randomized).toBe(1)
    expect(report.journal.byAssignment['excluded-rule']).toBe(2)
    expect(report.journal.byAssignment.hash).toBe(1)
  })
})
