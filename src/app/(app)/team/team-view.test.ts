import { describe, expect, it } from 'vitest'
import type { TeamLoadDto, TeamMemberDto } from '@/shared/contracts'
import { displayRule, groupMembers, loadSegments, matchesQuery, parseTab, scalePosition, visibleMembers, weekLabel } from './team-view'

/** Экран «Команда» (решение 203): вкладки, поиск, группы и полоса нагрузки. */

const RULE = { overdueWeight: 3, normMax: 40, highMax: 50, scaleMax: 60 }

function load(cooperations: number, meetings: number, overdue: number): TeamLoadDto {
  const points = cooperations + meetings + 3 * overdue
  return { points, level: points > 50 ? 'OVERLOADED' : points > 40 ? 'HIGH' : 'NORMAL', cooperations, meetings, overdue }
}

function member(partial: Partial<TeamMemberDto> & Pick<TeamMemberDto, 'id' | 'fullName'>): TeamMemberDto {
  return {
    position: null,
    role: 'MANAGER',
    canBeResponsible: true,
    activeCooperations: 0,
    universitiesCount: 0,
    universities: [],
    nearestDeadline: null,
    overdueStages: 0,
    meetingsThisWeek: 0,
    meetingsAhead: 0,
    openLetterTasks: 0,
    onTime: { closedOnTime: 0, closedWithDeadline: 0, percent: null },
    lastAction: null,
    daysSinceLastAction: null,
    isStale: false,
    load: null,
    ...partial,
  }
}

const TEAM = [
  member({ id: 'a', fullName: 'Кириллов Пётр Андреевич', load: load(36, 9, 3), overdueStages: 3, universities: ['ННГУ', 'ПГУТИ'] }),
  member({ id: 'b', fullName: 'Савельева Ольга Дмитриевна', load: load(29, 4, 1), overdueStages: 1, universities: ['ВГУ'] }),
  member({ id: 'c', fullName: 'Орлов Михаил Юрьевич', role: 'ANALYST', canBeResponsible: false, isStale: true, daysSinceLastAction: 9 }),
  member({ id: 'd', fullName: 'Лебедева Анна Сергеевна', role: 'VIEWER', position: 'Наблюдатель', isStale: true }),
]

describe('вкладки', () => {
  it('«Перегружены» — только уровень OVERLOADED', () => {
    expect(visibleMembers(TEAM, 'overloaded', '').map((item) => item.id)).toEqual(['a'])
  })

  it('«С просрочками» и «Без движения 7+ дней»', () => {
    expect(visibleMembers(TEAM, 'overdue', '').map((item) => item.id)).toEqual(['a', 'b'])
    expect(visibleMembers(TEAM, 'stale', '').map((item) => item.id)).toEqual(['c', 'd'])
  })
})

describe('вкладка из адреса', () => {
  it('знакомая — она, незнакомая или пустая — «Все»', () => {
    expect(parseTab('overdue')).toBe('overdue')
    expect(parseTab('stale')).toBe('stale')
    expect(parseTab('чепуха')).toBe('all')
    expect(parseTab(null)).toBe('all')
  })
})

describe('поиск', () => {
  it('по ФИО, роли, должности и вузам; все слова запроса, без разницы е/ё', () => {
    expect(matchesQuery(TEAM[0]!, 'кириллов пётр')).toBe(true)
    expect(matchesQuery(TEAM[0]!, 'петр')).toBe(true)
    expect(matchesQuery(TEAM[0]!, 'пгути')).toBe(true)
    expect(matchesQuery(TEAM[2]!, 'аналитик')).toBe(true)
    expect(matchesQuery(TEAM[3]!, 'наблюдатель лебедева')).toBe(true)
    expect(matchesQuery(TEAM[1]!, 'кириллов')).toBe(false)
  })
})

describe('группы', () => {
  it('«Ведут связки» — по убыванию нагрузки, остальные — отдельно', () => {
    const { owners, others } = groupMembers([TEAM[1]!, TEAM[2]!, TEAM[0]!])
    expect(owners.map((item) => item.id)).toEqual(['a', 'b'])
    expect(others.map((item) => item.id)).toEqual(['c'])
  })
})

describe('полоса нагрузки', () => {
  it('доли связок, встреч и просрочек на шкале', () => {
    const parts = loadSegments(load(36, 9, 3), RULE)
    expect(parts.cooperations).toBeCloseTo(60)
    expect(parts.meetings).toBeCloseTo(15)
    expect(parts.overdue).toBeCloseTo(15)
  })

  it('шкала растягивается до наибольшего балла команды — просрочка у перегруженного видна', () => {
    const heavy = load(33, 52, 2) // 91 балл
    const rule = displayRule(RULE, [heavy, null, load(10, 0, 0)])
    expect(rule.scaleMax).toBe(100)
    expect(loadSegments(heavy, rule).overdue).toBeCloseTo(6)
    // Пороги на той же шкале — одно место для всех строк.
    expect(scalePosition(40, rule)).toBe(40)
  })

  it('без перегруженных шкала — из конфига', () => {
    expect(displayRule(RULE, [load(20, 4, 1)]).scaleMax).toBe(60)
  })
})

describe('неделя', () => {
  it('подпись — с понедельника по воскресенье, правая граница не включается', () => {
    expect(weekLabel({ from: '2026-09-20T21:00:00.000Z', to: '2026-09-27T21:00:00.000Z' })).toMatch(/^21 .+ – 27 /)
  })
})
