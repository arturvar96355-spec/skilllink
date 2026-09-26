import {
  DSAR_DEADLINES,
  FIXED_HOLIDAYS,
  GOVERNMENT_TRANSFERS,
} from '@/shared/config/dsar.config'
import { CLIENT_ADDRESS_KEY } from '@/modules/audit/retention.rules'

/**
 * Чистые правила «всего о субъекте» (решение 116): сроки в рабочих днях,
 * заглушки обезличивания, проверка подтверждения, чистка выгрузки.
 */

// ── Обезличенный пользователь ───────────────────────────────────────────────

export const ERASED_USER_NAME = 'Пользователь удалён'

/**
 * Почта-заглушка. Почта — уникальный логин, поэтому заглушка своя у каждого:
 * домен `.invalid` зарезервирован (RFC 2606) и никуда не доставляется, а по
 * идентификатору прежнюю почту не восстановить.
 */
export function erasedUserEmail(userId: string): string {
  return `erased-${userId}@erased.invalid`
}

export function isErasedUser(user: { id: string; email: string; fullName: string }): boolean {
  return user.fullName === ERASED_USER_NAME && user.email === erasedUserEmail(user.id)
}

/**
 * Подтверждение необратимого действия: администратор вводит логин (почту)
 * пользователя или ФИО контакта. Регистр и крайние пробелы не важны.
 */
export function confirmMatches(typed: string, expected: string | null): boolean {
  if (!expected) return false
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU')
  return normalize(typed) !== '' && normalize(typed) === normalize(expected)
}

// ── Рабочие дни ─────────────────────────────────────────────────────────────

const MS_IN_DAY = 24 * 60 * 60 * 1000
/** Москва — UTC+3 круглый год. */
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000

/** Номер московских суток (дни от эпохи). */
function moscowDay(date: Date): number {
  return Math.floor((date.getTime() + MOSCOW_OFFSET_MS) / MS_IN_DAY)
}

function isoOfDay(day: number): string {
  return new Date(day * MS_IN_DAY).toISOString().slice(0, 10)
}

function weekdayOfDay(day: number): number {
  return new Date(day * MS_IN_DAY).getUTCDay()
}

const offDaysCache = new Map<number, Set<string>>()

/**
 * Нерабочие дни года, кроме суббот и воскресений: праздники ст. 112 ТК РФ,
 * перенос выходного, совпавшего с праздником (кроме январских, ч. 2 ст. 112),
 * и переносы постановлением Правительства, если год записан в конфиге.
 */
export function holidaysOf(year: number): Set<string> {
  const cached = offDaysCache.get(year)
  if (cached) return cached

  const result = new Set<string>(FIXED_HOLIDAYS.map((monthDay) => `${year}-${monthDay}`))
  for (const monthDay of FIXED_HOLIDAYS) {
    if (monthDay.startsWith('01-')) continue
    let day = Date.UTC(year, Number(monthDay.slice(0, 2)) - 1, Number(monthDay.slice(3))) / MS_IN_DAY
    const weekday = weekdayOfDay(day)
    if (weekday !== 0 && weekday !== 6) continue
    // Следующий рабочий день после праздника становится выходным.
    do {
      day += 1
    } while (weekdayOfDay(day) === 0 || weekdayOfDay(day) === 6 || result.has(isoOfDay(day)))
    result.add(isoOfDay(day))
  }
  for (const day of GOVERNMENT_TRANSFERS[year]?.daysOff ?? []) result.add(day)
  offDaysCache.set(year, result)
  return result
}

/** Рабочий ли день (дата `ГГГГ-ММ-ДД`). */
export function isWorkingDay(isoDate: string): boolean {
  const year = Number(isoDate.slice(0, 4))
  if (GOVERNMENT_TRANSFERS[year]?.workdays.includes(isoDate)) return true
  const weekday = new Date(`${isoDate}T00:00:00Z`).getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  return !holidaysOf(year).has(isoDate)
}

/**
 * Конец N-го рабочего дня после дня `from` по Москве. Отсчёт — со следующего дня
 * (ст. 191 ГК РФ: срок начинается на следующий день после события), срок истекает
 * в 23:59:59.999 по Москве последнего рабочего дня (ст. 194 ГК РФ).
 */
export function addWorkingDays(from: Date, workingDays: number): Date {
  if (!Number.isInteger(workingDays) || workingDays < 1) {
    throw new Error(`Срок в рабочих днях должен быть целым не меньше 1, а не ${workingDays}`)
  }
  let day = moscowDay(from)
  let counted = 0
  while (counted < workingDays) {
    day += 1
    if (isWorkingDay(isoOfDay(day))) counted += 1
  }
  return new Date((day + 1) * MS_IN_DAY - MOSCOW_OFFSET_MS - 1)
}

/** Срок ответа на запрос: 10 рабочих дней на сведения, 7 — на уничтожение. */
export function dueDate(kind: keyof typeof DSAR_DEADLINES, requestedAt: Date): Date {
  return addWorkingDays(requestedAt, DSAR_DEADLINES[kind].workingDays)
}

// ── Чистка выгрузки ─────────────────────────────────────────────────────────

/** Ключи, которых в выгрузке не должно быть ни на какой глубине. */
export const SECRET_KEY_PATTERN = /password|secret|token|hash/i

/** Пути к ключам, похожим на секрет, — рекурсивно по объектам и массивам. */
export function findSecretKeys(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => findSecretKeys(item, `${path}[${index}]`))
  if (value === null || typeof value !== 'object' || value instanceof Date) return []
  return Object.entries(value).flatMap(([key, nested]) => [
    ...(SECRET_KEY_PATTERN.test(key) ? [`${path}.${key}`] : []),
    ...findSecretKeys(nested, `${path}.${key}`),
  ])
}

/**
 * Запись журнала о действии над субъектом: адрес клиента в ней — адрес того,
 * кто действовал (сотрудника оператора), а не субъекта. Он вырезается.
 */
export function withoutClientAddress(payload: unknown): unknown {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload
  if (!(CLIENT_ADDRESS_KEY in payload)) return payload
  const copy = { ...(payload as Record<string, unknown>) }
  delete copy[CLIENT_ADDRESS_KEY]
  return copy
}

/** Сколько секунд ждать до следующей самостоятельной выгрузки; 0 — можно сейчас. */
export function selfExportRetryAfter(last: Date | null, now: Date, intervalMinutes: number): number {
  if (!last) return 0
  const nextAllowed = last.getTime() + intervalMinutes * 60 * 1000
  return Math.max(0, Math.ceil((nextAllowed - now.getTime()) / 1000))
}
