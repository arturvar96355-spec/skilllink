const MS_IN_DAY = 24 * 60 * 60 * 1000

/** Даты наружу отдаются строкой ISO 8601 в UTC. */
export function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

export function toIsoRequired(value: Date): string {
  return value.toISOString()
}

/**
 * Смещение московских суток от UTC.
 *
 * Сутки считаются по Москве — там же, где их показывает интерфейс
 * (`TIME_ZONE` в `src/ui/lib/format.ts`). По UTC нельзя: срок «01.10, 01:00»
 * по Москве — это 30.09, 22:00 по UTC, и 30 сентября днём рядом с датой «01.10»
 * стояло бы «срок через 0 дн.». Перехода на летнее время
 * в Москве с 2014 года нет, поэтому смещение постоянное.
 */
const BUSINESS_DAY_OFFSET_MS = 3 * 60 * 60 * 1000

/** Номер московских суток — для сравнения дат по календарю, а не по часам. */
function businessDay(date: Date): number {
  return Math.floor((date.getTime() + BUSINESS_DAY_OFFSET_MS) / MS_IN_DAY)
}

/**
 * Календарных дней от `from` до `to` по московским суткам. Отрицательное
 * значение — `to` уже в прошлом; ноль — тот же день, даже если часы разные.
 */
export function daysBetween(from: Date, to: Date): number {
  return businessDay(to) - businessDay(from)
}

/**
 * Начало московских суток, сдвинутых на `shiftDays` от суток `date`.
 * Для условий «не меньше N календарных дней» в запросах к базе.
 */
export function moscowDayStart(date: Date, shiftDays = 0): Date {
  return new Date((businessDay(date) + shiftDays) * MS_IN_DAY - BUSINESS_DAY_OFFSET_MS)
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_IN_DAY)
}

/** Дней до дедлайна. null, если срок не задан. */
export function daysToDeadline(deadline: Date | null, now: Date = new Date()): number | null {
  return deadline ? daysBetween(now, deadline) : null
}
