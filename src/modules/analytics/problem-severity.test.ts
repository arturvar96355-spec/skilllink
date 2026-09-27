import { describe, expect, it } from 'vitest'
import { PROBLEM_LONG_OVERDUE_DAYS } from '@/shared/config/analytics.config'
import { countProblemGroups, problemSeverity } from './problem-severity'

/** Полдень по Москве — чтобы граница суток не влияла на счёт дней. */
const NOW = new Date('2026-09-27T09:00:00Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)

describe('серьёзность проблемного этапа (решение 206)', () => {
  it('порог «месяц» — 30 дней, в конфиге', () => {
    expect(PROBLEM_LONG_OVERDUE_DAYS).toBe(30)
  })

  it('заблокированный — своя группа, срок не важен', () => {
    expect(problemSeverity({ status: 'BLOCKED', deadline: daysAgo(90) }, NOW, 30)).toEqual({
      severity: 'blocked',
      daysOverdue: null,
    })
    expect(problemSeverity({ status: 'BLOCKED', deadline: null }, NOW, 30).severity).toBe('blocked')
  })

  it('просрочка ровно на порог — ещё «до месяца», на день больше — уже «больше месяца»', () => {
    expect(problemSeverity({ status: 'IN_PROGRESS', deadline: daysAgo(30) }, NOW, 30)).toEqual({
      severity: 'overdue',
      daysOverdue: 30,
    })
    expect(problemSeverity({ status: 'IN_PROGRESS', deadline: daysAgo(31) }, NOW, 30)).toEqual({
      severity: 'overdue-long',
      daysOverdue: 31,
    })
  })

  it('срок вышел сегодня — просрочка на 0 дней, группа «до месяца»', () => {
    const earlierToday = new Date(NOW.getTime() - 60 * 60 * 1000)
    expect(problemSeverity({ status: 'IN_PROGRESS', deadline: earlierToday }, NOW, 30)).toEqual({
      severity: 'overdue',
      daysOverdue: 0,
    })
  })

  it('порог берётся из аргумента, а не зашит', () => {
    expect(problemSeverity({ status: 'IN_PROGRESS', deadline: daysAgo(10) }, NOW, 7).severity).toBe('overdue-long')
  })

  it('счётчики групп — по всем этапам, в сумме дают общее число', () => {
    const stages = [
      { status: 'IN_PROGRESS', deadline: daysAgo(101) },
      { status: 'IN_PROGRESS', deadline: daysAgo(57) },
      { status: 'IN_PROGRESS', deadline: daysAgo(39) },
      { status: 'IN_PROGRESS', deadline: daysAgo(15) },
      { status: 'IN_PROGRESS', deadline: daysAgo(5) },
      { status: 'BLOCKED', deadline: daysAgo(-20) },
      { status: 'BLOCKED', deadline: null },
    ]
    const groups = countProblemGroups(stages, NOW, 30)
    expect(groups).toEqual({ overdueLong: 3, overdue: 2, blocked: 2, longOverdueDays: 30 })
    expect(groups.overdueLong + groups.overdue + groups.blocked).toBe(stages.length)
  })
})
