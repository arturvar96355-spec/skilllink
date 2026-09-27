import { describe, expect, it } from 'vitest'
import { TEAM_LOAD } from '@/shared/config/team.config'
import {
  availableMembers,
  averageLoad,
  daysSince,
  isStale,
  loadLevel,
  loadPoints,
  memberLoad,
  moscowWeek,
  topUniversities,
  isMeetingAhead,
} from './team.rules'

/** Правило нагрузки экрана «Команда» (решение 203): баллы, пороги, неделя, «без движения». */

describe('баллы нагрузки', () => {
  it('связки + встречи недели + 3 × просрочки', () => {
    expect(loadPoints({ cooperations: 36, meetings: 9, overdue: 3 })).toBe(54)
    expect(loadPoints({ cooperations: 29, meetings: 4, overdue: 1 })).toBe(36)
  })

  it('вес просрочки берётся из конфига, а не зашит', () => {
    const rule = { ...TEAM_LOAD, overdueWeight: 5 }
    expect(loadPoints({ cooperations: 10, meetings: 0, overdue: 2 }, rule)).toBe(20)
  })
})

describe('пороги нагрузки', () => {
  it.each([
    [0, 'NORMAL'],
    [40, 'NORMAL'],
    [41, 'HIGH'],
    [50, 'HIGH'],
    [51, 'OVERLOADED'],
    [120, 'OVERLOADED'],
  ] as const)('%i баллов — %s', (points, level) => {
    expect(loadLevel(points)).toBe(level)
  })

  it('пороги читаются из конфига', () => {
    const rule = { ...TEAM_LOAD, normMax: 10, highMax: 20 }
    expect(loadLevel(11, rule)).toBe('HIGH')
    expect(loadLevel(21, rule)).toBe('OVERLOADED')
  })

  it('кто связки не ведёт — нагрузки нет (null), а не «Норма 0»', () => {
    expect(memberLoad({ cooperations: 0, meetings: 3, overdue: 0 })).toBeNull()
  })

  it('нагрузка раскладывается на составляющие', () => {
    expect(memberLoad({ cooperations: 36, meetings: 9, overdue: 3 })).toEqual({
      points: 54,
      level: 'OVERLOADED',
      cooperations: 36,
      meetings: 9,
      overdue: 3,
    })
  })
})

describe('итоги команды', () => {
  const load = (points: number) => ({ points, level: loadLevel(points), cooperations: points, meetings: 0, overdue: 0 })

  it('средняя — по тем, у кого нагрузка есть, целым числом', () => {
    expect(averageLoad([load(54), load(36), null])).toBe(45)
    expect(averageLoad([null, null])).toBeNull()
  })

  it('кто может взять связку: в норме, может быть ответственным, по возрастанию баллов', () => {
    const members = [
      { id: 'a', fullName: 'Кириллов', canBeResponsible: true, load: load(54) },
      { id: 'b', fullName: 'Савельева', canBeResponsible: true, load: load(36) },
      { id: 'c', fullName: 'Иванова', canBeResponsible: true, load: load(12) },
      { id: 'd', fullName: 'Орлов', canBeResponsible: false, load: load(5) },
      { id: 'e', fullName: 'Демидова', canBeResponsible: true, load: null },
    ]
    expect(availableMembers(members)).toEqual([
      { userId: 'c', fullName: 'Иванова', points: 12, capacity: 28 },
      { userId: 'b', fullName: 'Савельева', points: 36, capacity: 4 },
    ])
  })
})

describe('московская неделя', () => {
  it('воскресенье вечером — ещё текущая неделя с понедельника', () => {
    // 27.09.2026, 21:30 по Москве — воскресенье.
    const week = moscowWeek(new Date('2026-09-27T18:30:00.000Z'))
    expect(week.from.toISOString()).toBe('2026-09-20T21:00:00.000Z') // пн 21.09, 00:00 МСК
    expect(week.to.toISOString()).toBe('2026-09-27T21:00:00.000Z') // пн 28.09, 00:00 МСК
  })

  it('понедельник 00:30 по Москве — уже новая неделя, хотя по UTC ещё воскресенье', () => {
    const week = moscowWeek(new Date('2026-09-27T21:30:00.000Z'))
    expect(week.from.toISOString()).toBe('2026-09-27T21:00:00.000Z')
    expect(week.to.toISOString()).toBe('2026-10-04T21:00:00.000Z')
  })
})

describe('без движения', () => {
  const now = new Date('2026-09-27T12:00:00.000Z')

  it('дни — по московским суткам', () => {
    expect(daysSince(new Date('2026-09-27T06:00:00.000Z'), now)).toBe(0)
    expect(daysSince(new Date('2026-09-20T12:00:00.000Z'), now)).toBe(7)
    expect(daysSince(null, now)).toBeNull()
  })

  it('7 дней и больше или ни одного действия — без движения', () => {
    expect(isStale(6, 7)).toBe(false)
    expect(isStale(7, 7)).toBe(true)
    expect(isStale(null, 7)).toBe(true)
  })
})

describe('вузы сотрудника', () => {
  it('первые — где больше его связок; всего — разных вузов', () => {
    const rows = [
      { universityId: 'u1', label: 'ННГУ' },
      { universityId: 'u2', label: 'ПГУТИ' },
      { universityId: 'u2', label: 'ПГУТИ' },
      { universityId: 'u3', label: 'ВГУ' },
      { universityId: 'u4', label: 'СФУ' },
    ]
    expect(topUniversities(rows, 3)).toEqual({ total: 4, names: ['ПГУТИ', 'ВГУ', 'ННГУ'] })
  })
})

describe('встречи в нагрузке — только впереди', () => {
  // Четверг 24.09 12:00 МСК; неделя — пн 21.09 00:00 МСК … пн 28.09 00:00 МСК.
  const now = new Date('2026-09-24T09:00:00.000Z')
  const week = moscowWeek(now)

  it('прошедшая на этой неделе встреча — уже не нагрузка', () => {
    expect(isMeetingAhead(new Date('2026-09-22T07:00:00.000Z'), now, week)).toBe(false)
    expect(isMeetingAhead(new Date('2026-09-24T08:59:59.000Z'), now, week)).toBe(false)
  })

  it('встреча с этого момента до конца недели — нагрузка', () => {
    expect(isMeetingAhead(now, now, week)).toBe(true)
    expect(isMeetingAhead(new Date('2026-09-27T20:59:00.000Z'), now, week)).toBe(true) // вс 23:59 МСК
  })

  it('следующая неделя — ещё не нагрузка этой недели', () => {
    expect(isMeetingAhead(new Date('2026-09-27T21:00:00.000Z'), now, week)).toBe(false) // пн 00:00 МСК
  })
})
