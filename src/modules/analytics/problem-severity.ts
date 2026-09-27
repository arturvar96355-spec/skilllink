import type { ProblemGroupsDto, ProblemSeverity } from '@/shared/contracts/analytics'
import { daysBetween } from '@/shared/utils/date'

/**
 * Серьёзность проблемного этапа для блока «Требует внимания» (решение 206).
 *
 * Одна функция на строку и на счётчики групп: если строка и счётчик посчитают
 * серьёзность по-разному, группа «больше месяца · 3» покажет не те три строки.
 *
 * - `blocked` — этап заблокирован, срок тут не важен: работа стоит по внешней причине;
 * - `overdue-long` — срок вышел больше чем `longDays` дней назад;
 * - `overdue` — срок вышел, но не раньше `longDays` дней назад (включая «сегодня»).
 *
 * `daysOverdue` — сколько московских суток прошло после срока; у блокировки `null`
 * (так и было в `ProblemCooperationDto.daysOverdue`: «блок», а не «−N дн.»).
 */
export function problemSeverity(
  stage: { status: string; deadline: Date | null },
  now: Date,
  longDays: number,
): { severity: ProblemSeverity; daysOverdue: number | null } {
  if (stage.status === 'BLOCKED' || stage.deadline === null) {
    return { severity: 'blocked', daysOverdue: null }
  }
  const days = Math.max(0, daysBetween(stage.deadline, now))
  return { severity: days > longDays ? 'overdue-long' : 'overdue', daysOverdue: days }
}

/** Счётчики трёх групп по всем проблемным этапам, а не только по показанным строкам. */
export function countProblemGroups(
  stages: ReadonlyArray<{ status: string; deadline: Date | null }>,
  now: Date,
  longDays: number,
): ProblemGroupsDto {
  const counts: ProblemGroupsDto = { overdueLong: 0, overdue: 0, blocked: 0, longOverdueDays: longDays }
  for (const stage of stages) {
    const { severity } = problemSeverity(stage, now, longDays)
    if (severity === 'blocked') counts.blocked += 1
    else if (severity === 'overdue-long') counts.overdueLong += 1
    else counts.overdue += 1
  }
  return counts
}
