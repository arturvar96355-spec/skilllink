import { describe, expect, it } from 'vitest'
import { daysBetween, daysToDeadline } from './date'

const at = (iso: string) => new Date(iso)

describe('дни считаются по московскому календарю', () => {
  it('тот же московский день — ноль, как бы ни различались часы', () => {
    expect(daysBetween(at('2026-09-30T06:00:00+03:00'), at('2026-09-30T23:30:00+03:00'))).toBe(0)
  })

  it('срок в первые часы суток по Москве — это уже следующий день', () => {
    // 01.10 01:00 по Москве — 30.09 22:00 по UTC. По UTC вышло бы «0 дн.»
    // рядом с датой «01.10».
    const deadline = at('2026-10-01T01:00:00+03:00')
    expect(daysToDeadline(deadline, at('2026-09-30T12:00:00+03:00'))).toBe(1)
  })

  it('полночь по Москве разделяет сутки, полночь по UTC — нет', () => {
    const lateEvening = at('2026-09-30T23:59:00+03:00')
    const afterMidnight = at('2026-10-01T00:01:00+03:00')
    expect(daysBetween(lateEvening, afterMidnight)).toBe(1)

    const beforeUtcMidnight = at('2026-10-01T02:59:00+03:00')
    const afterUtcMidnight = at('2026-10-01T03:01:00+03:00')
    expect(daysBetween(beforeUtcMidnight, afterUtcMidnight)).toBe(0)
  })

  it('прошедший срок — отрицательное число дней', () => {
    expect(daysToDeadline(at('2026-09-20T15:00:00+03:00'), at('2026-09-23T10:00:00+03:00'))).toBe(-3)
  })

  it('разница целых суток не зависит от времени суток', () => {
    const now = at('2026-09-23T10:18:06+03:00')
    const day = 24 * 60 * 60 * 1000
    expect(daysBetween(new Date(now.getTime() - 210 * day), new Date(now.getTime() + 30 * day))).toBe(240)
  })

  it('без срока — null', () => {
    expect(daysToDeadline(null)).toBeNull()
  })
})
