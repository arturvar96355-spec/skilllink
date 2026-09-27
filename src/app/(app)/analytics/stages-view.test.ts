import { describe, expect, it } from 'vitest'
import type { StageDurationDto } from '@/shared/contracts'
import { durationRows, durationsConclusion, stagesConclusion } from './stages-view'

function stage(stageNumber: number, median: number | null, threshold: number, status: StageDurationDto['status'] = 'ok'): StageDurationDto {
  return {
    stageNumber,
    title: `Этап ${stageNumber}`,
    status,
    n: 10,
    events: 8,
    censored: 2,
    median,
    p90: null,
    ci: { median: { low: null, high: null }, p90: { low: null, high: null } },
    curve: [],
    threshold: { days: threshold, source: 'manual', ci: null, n: 10, events: 8, reason: 'insufficient_data' },
  }
}

describe('вкладка «Этапы» (решение 215)', () => {
  it('вывод: где копятся связки — по просрочкам и блокировкам, «из N» в работе', () => {
    expect(
      stagesConclusion([
        { stageNumber: 3, title: 'Встреча', inProgress: 5, overdue: 1, blocked: 0 },
        { stageNumber: 6, title: 'Подписание', inProgress: 9, overdue: 2, blocked: 2 },
      ]),
    ).toBe('Связки копятся на этапе 6 «Подписание»: сейчас на нём 9 из 14, просрочено 2, заблокировано 2.')
  })

  it('без проблем — называет самый загруженный этап', () => {
    expect(
      stagesConclusion([
        { stageNumber: 1, title: 'Контакт', inProgress: 2, overdue: 0, blocked: 0 },
        { stageNumber: 2, title: 'Связь', inProgress: 4, overdue: 0, blocked: 0 },
      ]),
    ).toBe('Просрочек и блокировок нет; больше всего связок на этапе 2 «Связь»: 4 из 6.')
  })

  it('длительность: дольше порога — жёлтым и словами, медианы нет — «нет данных», а не ноль', () => {
    const { rows, max } = durationRows([stage(1, 5, 8), stage(11, 29, 14, 'insufficient_data'), stage(12, null, 14)])
    expect(max).toBe(29)
    expect(rows[0]).toMatchObject({ valueText: '5 дней', tone: 'default', note: 'в пределах порога (8 дн.)' })
    expect(rows[1]).toMatchObject({ tone: 'warning', note: 'на 15 дней дольше порога (14 дн.)', noteTone: 'warning' })
    expect(rows[1]!.caption).toContain('данных мало')
    expect(rows[2]).toMatchObject({ value: null, valueText: 'нет данных' })
  })

  it('вывод по длительности', () => {
    expect(durationsConclusion([stage(1, 5, 8), stage(11, 29, 14)])).toBe(
      'Дольше порога застоя обычно идут 1 из 2 этапов; сильнее всего — 11 «Этап 11»: 29 дней при пороге 14 дней.',
    )
    expect(durationsConclusion([stage(1, 5, 8)])).toBe('Все этапы обычно укладываются в порог застоя.')
  })
})
