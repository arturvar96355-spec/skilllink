const MS_IN_DAY = 24 * 60 * 60 * 1000

/** Даты наружу отдаются строкой ISO 8601 в UTC. */
export function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

export function toIsoRequired(value: Date): string {
  return value.toISOString()
}

/** Полных дней от `from` до `to`. Отрицательное значение — `to` уже в прошлом. */
export function daysBetween(from: Date, to: Date): number {
  const fromDay = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const toDay = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  return Math.round((toDay - fromDay) / MS_IN_DAY)
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_IN_DAY)
}

/** Дней до дедлайна. null, если срок не задан. */
export function daysToDeadline(deadline: Date | null, now: Date = new Date()): number | null {
  return deadline ? daysBetween(now, deadline) : null
}
