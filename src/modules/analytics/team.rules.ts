import { TEAM_LOAD } from '@/shared/config/team.config'
import type { TeamLoadDto, TeamLoadLevel, TeamLoadRuleDto } from '@/shared/contracts/team'
import { daysBetween, moscowDayStart, moscowIsoDate } from '@/shared/utils/date'

/**
 * Правила экрана «Команда» (решение 203) — чистые функции без базы: их проверяют
 * тесты, а сервис лишь подставляет посчитанные запросами числа.
 */

export const LOAD_RULE: TeamLoadRuleDto = { ...TEAM_LOAD }

/** Баллы нагрузки: связки в работе + встречи на неделе + вес × просроченные этапы. */
export function loadPoints(
  input: { cooperations: number; meetings: number; overdue: number },
  rule: TeamLoadRuleDto = LOAD_RULE,
): number {
  return input.cooperations + input.meetings + rule.overdueWeight * input.overdue
}

/** До `normMax` включительно — норма, до `highMax` включительно — высокая, выше — перегружен. */
export function loadLevel(points: number, rule: TeamLoadRuleDto = LOAD_RULE): TeamLoadLevel {
  if (points > rule.highMax) return 'OVERLOADED'
  if (points > rule.normMax) return 'HIGH'
  return 'NORMAL'
}

/**
 * Нагрузка сотрудника. Кто связки не ведёт — `null`: встречи и письма у него есть,
 * но правило нагрузки придумано для тех, кто ведёт связки, и «Норма» у
 * администратора без единой связки читалась бы как «может взять ещё».
 */
export function memberLoad(
  input: { cooperations: number; meetings: number; overdue: number },
  rule: TeamLoadRuleDto = LOAD_RULE,
): TeamLoadDto | null {
  if (input.cooperations === 0) return null
  const points = loadPoints(input, rule)
  return { points, level: loadLevel(points, rule), ...input }
}

/** Средняя нагрузка — целым числом, по тем, у кого она есть. `null` — не у кого. */
export function averageLoad(loads: readonly (TeamLoadDto | null)[]): number | null {
  const present = loads.filter((load): load is TeamLoadDto => load !== null)
  if (present.length === 0) return null
  return Math.round(present.reduce((sum, load) => sum + load.points, 0) / present.length)
}

/**
 * Кто может взять связку: может быть ответственным, нагрузка в норме — по возрастанию
 * баллов. Запас — сколько баллов до верхней границы нормы.
 */
export function availableMembers<T extends { id: string; fullName: string; canBeResponsible: boolean; load: TeamLoadDto | null }>(
  members: readonly T[],
  rule: TeamLoadRuleDto = LOAD_RULE,
): Array<{ userId: string; fullName: string; points: number; capacity: number }> {
  return members
    .filter((member) => member.canBeResponsible && member.load !== null && member.load.level === 'NORMAL')
    .map((member) => ({
      userId: member.id,
      fullName: member.fullName,
      points: member.load!.points,
      capacity: rule.normMax - member.load!.points,
    }))
    .sort((a, b) => a.points - b.points || a.fullName.localeCompare(b.fullName, 'ru'))
}

/**
 * Московская календарная неделя, в которую попадает `now`: понедельник 00:00 по Москве
 * и следующий понедельник 00:00 (правая граница не включается).
 */
export function moscowWeek(now: Date): { from: Date; to: Date } {
  // День недели московской даты: у полуночи UTC той же даты он тот же.
  const weekday = new Date(`${moscowIsoDate(now)}T00:00:00.000Z`).getUTCDay()
  const sinceMonday = (weekday + 6) % 7
  return { from: moscowDayStart(now, -sinceMonday), to: moscowDayStart(now, 7 - sinceMonday) }
}

/** Дней с последнего действия по московским суткам; `null` — действий не было. */
export function daysSince(at: Date | null, now: Date): number | null {
  return at ? Math.max(0, daysBetween(at, now)) : null
}

/** Без движения: действий не было вовсе или последнее — `staleDays` суток назад и раньше. */
export function isStale(days: number | null, staleDays: number): boolean {
  return days === null || days >= staleDays
}

/**
 * Первые вузы сотрудника — по числу его связок в вузе, при равенстве по алфавиту.
 * Краткое название, а если его нет — полное.
 */
export function topUniversities(
  rows: readonly { universityId: string; label: string }[],
  limit: number,
): { total: number; names: string[] } {
  const counts = new Map<string, { label: string; count: number }>()
  for (const row of rows) {
    const entry = counts.get(row.universityId)
    if (entry) entry.count += 1
    else counts.set(row.universityId, { label: row.label, count: 1 })
  }
  const names = [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ru'))
    .slice(0, limit)
    .map((entry) => entry.label)
  return { total: counts.size, names }
}
