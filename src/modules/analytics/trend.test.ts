import { describe, expect, it } from 'vitest'
import { compareWithPast, isClosedOnTime, onTimePercent } from './trend'

const day = (n: number) => new Date(Date.UTC(2026, 8, n))

describe('тренд показателей главной', () => {
  it('этап в срок — закрыт не позже срока', () => {
    expect(isClosedOnTime({ deadline: day(10), completedAt: day(10) })).toBe(true)
    expect(isClosedOnTime({ deadline: day(10), completedAt: day(11) })).toBe(false)
    expect(isClosedOnTime({ deadline: null, completedAt: day(1) })).toBe(false)
  })

  it('доля в срок без этапов — «нет данных», а не ноль', () => {
    expect(onTimePercent([])).toBeNull()
    expect(
      onTimePercent([
        { deadline: day(10), completedAt: day(9) },
        { deadline: day(10), completedAt: day(12) },
      ]),
    ).toBe(50)
  })

  it('изменение и направление к началу периода', () => {
    expect(compareWithPast(89.1, 86.8)).toEqual({
      previous: 86.8,
      delta: 2.3,
      direction: 'up',
      periodLabel: 'за 30 дней',
    })
    expect(compareWithPast(7, 8).direction).toBe('down')
    expect(compareWithPast(7, 7)).toMatchObject({ delta: 0, direction: 'flat' })
  })

  it('дробные разницы не дают «хвостов» вроде 0.30000000000000004', () => {
    expect(compareWithPast(0.3, 0.1).delta).toBe(0.2)
  })
})
