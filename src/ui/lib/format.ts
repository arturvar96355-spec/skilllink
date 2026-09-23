import type { Metric } from '@/shared/contracts'
import { outOf100 } from '@/shared/utils/number'
import { plural } from '@/shared/utils/text'

/**
 * Форматирование чисел, дат и показателей.
 *
 * Здесь же — единственное место, где появляется текст «Нет данных». Решение 8
 * проекта: пустой показатель никогда не превращается в ноль, потому что ноль
 * читается как «плохо», а правда — «мы не знаем».
 */

export const NO_DATA = 'Нет данных'

/**
 * Часовой пояс интерфейса зафиксирован.
 *
 * Сервер отдаёт время в UTC. Если форматировать его поясом браузера, то же самое
 * время на сервере и на клиенте напечатается по-разному, и React сообщит
 * о расхождении разметки. Показ идёт в Москве — берём её пояс явно.
 */
const TIME_ZONE = 'Europe/Moscow'

const numberFormat = new Intl.NumberFormat('ru-RU')
const scoreFormat = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: TIME_ZONE,
})
const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIME_ZONE,
})
const monthDayFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  timeZone: TIME_ZONE,
})

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return NO_DATA
  return numberFormat.format(value)
}

/** Балл рейтинга: всегда один знак после запятой, чтобы столбец не прыгал. */
export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return NO_DATA
  return scoreFormat.format(value)
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return NO_DATA
  return `${scoreFormat.format(value)}%`
}

/**
 * Доля от 0 до 1 — целым процентом: покрытие навыка, дефицит, вес показателя.
 *
 * Раньше каждый экран решал сам: в аналитике «77,0%» и «вес 0,4», в карточке
 * программы — «77%» и «40,0%». Одна и та же величина читалась по-разному.
 */
export function formatShare(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return NO_DATA
  return `${Math.round(value * 100)}%`
}

/** Спрос на навык, нормированный к 0..1, — «77 из 100». */
export function formatDemand(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return NO_DATA
  return `${outOf100(value)} из 100`
}

/** Показатель вместе с единицей измерения; `basis: "none"` — «Нет данных». */
export function formatMetric(metric: Metric | null | undefined): string {
  if (!metric || metric.value === null) return NO_DATA
  const value = numberFormat.format(metric.value)
  const unit = metric.unit.trim()
  if (unit === '' || unit === 'шт') return value
  if (unit === '%') return `${value}%`
  return `${value} ${unit}`
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return NO_DATA
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return NO_DATA
  return dateFormat.format(date)
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return NO_DATA
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return NO_DATA
  return dateTimeFormat.format(date)
}

export function formatDayMonth(iso: string | null | undefined): string {
  if (!iso) return NO_DATA
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return NO_DATA
  return monthDayFormat.format(date)
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * «14 минут назад» для ленты уведомлений.
 *
 * Считается от переданного момента «сейчас», а не от `Date.now()` внутри:
 * иначе каждый пункт ленты считал бы своё время и соседние записи,
 * пришедшие одновременно, показывали бы разную давность.
 */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const diff = now - date.getTime()

  if (diff < 0) return formatDate(iso)
  if (diff < MINUTE) return 'только что'
  if (diff < HOUR) {
    const minutes = Math.floor(diff / MINUTE)
    return `${minutes} ${pluralize(minutes, ['минуту', 'минуты', 'минут'])} назад`
  }
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR)
    return `${hours} ${pluralize(hours, ['час', 'часа', 'часов'])} назад`
  }
  if (diff < 7 * DAY) {
    const days = Math.floor(diff / DAY)
    return days === 1 ? 'вчера' : `${days} ${pluralize(days, ['день', 'дня', 'дней'])} назад`
  }
  return formatDate(iso)
}

/**
 * Надпись значка срока этапа.
 *
 * В день срока — «сегодня», а не «0 дн.». Срок этапа — точный момент
 * (начало плюс норматив), и этап с утренним сроком к вечеру уже просрочен,
 * хотя календарных дней не прошло: значок писал «Просрочен на 0 дн.».
 */
export function deadlineBadgeText(
  kind: 'overdue' | 'dueSoon',
  days: number | null,
  compact = false,
): string {
  if (kind === 'overdue') {
    if (days === null) return 'Просрочен'
    const passed = Math.abs(days)
    if (passed === 0) return compact ? 'сегодня' : 'Срок вышел сегодня'
    return compact ? `−${passed} дн.` : `Просрочен на ${passed} дн.`
  }
  if (days === null) return 'Скоро срок'
  if (days <= 0) return compact ? 'сегодня' : 'Срок сегодня'
  return compact ? `${days} дн.` : `Срок через ${days} дн.`
}

/** Склонение по числу: pluralize(3, ['вуз', 'вуза', 'вузов']) → «вуза». */
export function pluralize(count: number, forms: [string, string, string]): string {
  // Правило одно на сервер и интерфейс: две копии уже разошлись бы на дробных числах.
  return plural(count, forms)
}

export function formatCount(count: number, forms: [string, string, string]): string {
  return `${numberFormat.format(count)} ${pluralize(count, forms)}`
}

/**
 * Срок этапа словами: «просрочен на 5 дней», «остался 1 день».
 *
 * Отрицательное значение `daysToDeadline` означает просрочку — это описано
 * в контракте, и переписывать знак в компонентах нельзя.
 */
export function formatDeadlineDistance(days: number | null): string | null {
  if (days === null) return null
  if (days < 0) {
    const overdue = Math.abs(days)
    return `просрочен на ${overdue} ${pluralize(overdue, ['день', 'дня', 'дней'])}`
  }
  if (days === 0) return 'срок сегодня'
  return `остал${days % 10 === 1 && days % 100 !== 11 ? 'ся' : 'ось'} ${days} ${pluralize(days, ['день', 'дня', 'дней'])}`
}

/** Инициалы для аватара: «Иванов Иван Иванович» → «ИИ». */
export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase()
}

/** Короткая аббревиатура программы для иконки: «Программная инженерия» → «ПИ». */
export function abbreviate(name: string): string {
  const words = name
    .trim()
    .split(/[\s-]+/)
    .filter((word) => word.length > 2 && !/^(и|в|на|для|по|с|о|от|из)$/i.test(word))
  if (words.length === 0) return name.slice(0, 2).toUpperCase()
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('')
}

/**
 * Дата из поля ввода в формат API.
 *
 * `<input type="date">` отдаёт «2026-10-01», а сервер ждёт полное время по ISO.
 * Подставляем полночь по UTC: у контрольных дат в системе нет времени суток,
 * и придумывать его — значит сдвигать дату на пояс пользователя.
 */
export function dateInputToIso(value: string): string | null {
  if (value.trim() === '') return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * Московское смещение от UTC. Перехода на летнее время в России нет с 2014 года,
 * поэтому смещение постоянное и таблица поясов не нужна.
 */
const MOSCOW_OFFSET = '+03:00'

/** Части даты и времени по Москве — чтобы собрать значение поля ввода. */
const inputPartsFormat = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: TIME_ZONE,
})

/**
 * Момент времени в формате поля «дата и время» — `2026-09-23T14:30` по Москве.
 *
 * Поле хранит время без пояса. Раньше его заполняли и читали поясом браузера,
 * а показывали по Москве: у сотрудника в Екатеринбурге встреча в 14:30 по его
 * часам записывалась и показывалась как 12:30.
 */
export function dateToDateTimeInput(date: Date = new Date()): string {
  const parts = Object.fromEntries(
    inputPartsFormat.formatToParts(date).map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

/** Значение поля «дата и время» (время московское) — в формат API. */
export function dateTimeInputToIso(value: string): string | null {
  if (value.trim() === '') return null
  const date = new Date(`${value}:00${MOSCOW_OFFSET}`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Обратное преобразование — для полей формы редактирования. */
export function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}
