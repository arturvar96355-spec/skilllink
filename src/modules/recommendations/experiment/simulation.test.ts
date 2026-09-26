import { describe, expect, it } from 'vitest'
import { mulberry32, simulate, type SimulationScenario } from './simulation'
import type { ReportSettings } from './report'

/**
 * Симуляция для слайда (решение 136, npm run recs:experiment-sim): та же оценка,
 * что и на настоящих данных, находит заложенный эффект и не находит эффект там,
 * где его нет.
 */

const REPORT_SETTINGS: Omit<ReportSettings, 'enabled' | 'controlShare' | 'horizonDays'> = {
  minControlForVerdict: 30,
  confidenceLevel: 0.95,
  sequentialAlpha: 0.05,
  sequentialBeta: 0.2,
  sequentialRelativeLift: 0.3,
  neverControlRules: [],
}

const WITH_EFFECT: SimulationScenario = {
  name: 'с эффектом',
  seed: 1,
  days: 182, // полгода
  signalsPerDay: 6,
  pControl: 0.3,
  pTreatment: 0.42,
  controlShare: 0.1,
  horizonDays: 30,
}

const WITHOUT_EFFECT: SimulationScenario = { ...WITH_EFFECT, name: 'без эффекта', pTreatment: 0.3 }

describe('mulberry32', () => {
  it('одно зерно — одна и та же последовательность', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const seqA = Array.from({ length: 10 }, () => a())
    const seqB = Array.from({ length: 10 }, () => b())
    expect(seqA).toEqual(seqB)
  })
  it('числа в [0, 1)', () => {
    const random = mulberry32(7)
    for (let i = 0; i < 1000; i += 1) {
      const v = random()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('simulate — полгода сигналов с известным эффектом', () => {
  it('интервал находит и накрывает заложенный прирост, статус — «прирост есть»', () => {
    const { report, trueLift } = simulate(WITH_EFFECT, REPORT_SETTINGS)
    expect(report.overall.nTreatment).toBeGreaterThan(REPORT_SETTINGS.minControlForVerdict)
    expect(report.overall.nControl).toBeGreaterThan(REPORT_SETTINGS.minControlForVerdict)
    expect(report.overall.status).toBe('lift')
    expect(report.overall.ci).not.toBeNull()
    expect(report.overall.ci!.low).toBeLessThanOrEqual(trueLift)
    expect(report.overall.ci!.high).toBeGreaterThanOrEqual(trueLift)
    // Заложенный прирост — 0,12 (0,42 - 0,30); оценка не обязана совпасть точно, но должна быть рядом.
    expect(report.overall.lift).not.toBeNull()
    expect(Math.abs(report.overall.lift! - trueLift)).toBeLessThan(0.1)
  })

  it('без разницы между группами — прирост не доказан', () => {
    const { report } = simulate(WITHOUT_EFFECT, REPORT_SETTINGS)
    expect(report.overall.status).toBe('not-proven')
  })

  it('детерминизм: тот же сценарий и то же зерно — тот же отчёт', () => {
    const first = simulate(WITH_EFFECT, REPORT_SETTINGS)
    const second = simulate(WITH_EFFECT, REPORT_SETTINGS)
    expect(second.report).toEqual(first.report)
  })

  it('на разных зёрнах статус никогда не «с рекомендацией хуже» — эффект заложен положительным', () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const { report } = simulate({ ...WITH_EFFECT, seed }, REPORT_SETTINGS)
      expect(report.overall.status).not.toBe('negative')
    }
  })
})
