/**
 * Выгрузка реестров в CSV (раздел 20 ТЗ, приоритет P2).
 *
 * Формат рассчитан на Excel: разделитель — точка с запятой, кодировка UTF-8 с BOM.
 * Без BOM Excel на Windows открывает кириллицу кракозябрами, и выгрузка становится
 * бесполезной ровно для тех, кому она нужна.
 */

import { METRIC_BASIS_LABELS } from '@/shared/contracts/labels'
import type { ProgramRatingDto, UniversityRatingDto } from '@/shared/contracts/rating'

export const CSV_DELIMITER = ';'
export const UTF8_BOM = '﻿'

export type CsvValue = string | number | boolean | null | undefined

/**
 * Экранирование значения ячейки.
 *
 * Значение, начинающееся с `=`, `+`, `-` или `@`, Excel считает формулой. Данные из базы
 * формулами быть не должны, поэтому такие значения предваряются апострофом — иначе выгрузка
 * превращается в вектор внедрения формул в чужую таблицу.
 */
export function escapeCsvValue(value: CsvValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'да' : 'нет'
  // Дробная часть — через запятую: файл открывают в русском Excel, и «61.3»
  // он читает как дату или текст, а не как число, — столбец не сортируется.
  if (typeof value === 'number') return Number.isFinite(value) ? String(value).replace('.', ',') : ''

  let text = value
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`

  const needsQuotes =
    text.includes(CSV_DELIMITER) || text.includes('"') || text.includes('\n') || text.includes('\r')

  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [
    headers.map(escapeCsvValue).join(CSV_DELIMITER),
    ...rows.map((row) => row.map(escapeCsvValue).join(CSV_DELIMITER)),
  ]
  // CRLF: так файл одинаково открывается и в Excel, и в LibreOffice.
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`
}

/** Дата в виде, понятном человеку в таблице. Пусто, если даты нет. */
export function csvDate(value: Date | null | undefined): string {
  if (!value) return ''
  return value.toLocaleDateString('ru-RU')
}

/** Имя файла выгрузки с датой: две выгрузки подряд не перезаписывают друг друга. */
export function exportFileName(prefix: string, now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 10)
  return `skilllink-${prefix}-${stamp}.csv`
}

/**
 * Код перечисления — русским словом из общего словаря подписей.
 * Код без подписи выводится как есть: пустая ячейка скрыла бы, что значение было.
 */
export function csvLabel<K extends string>(
  labels: Readonly<Record<K, string>>,
  value: K | null | undefined,
): string | null {
  if (value === null || value === undefined) return null
  return labels[value] ?? value
}

/** Колонки рейтинга программы — балл, основание и сколько показателей из трёх учтено. */
export const PROGRAM_RATING_HEADERS = ['Рейтинг', 'Основание рейтинга', 'Учтено показателей из 3']

/**
 * Рейтинг программы в строке выгрузки — из того же расчёта, что на экране.
 * «Нет данных» — пустой балл, а не ноль.
 */
export function programRatingCells(rating: ProgramRatingDto | undefined): CsvValue[] {
  if (!rating) return [null, METRIC_BASIS_LABELS.none, 0]
  return [
    rating.score,
    METRIC_BASIS_LABELS[rating.basis],
    rating.factors.filter((factor) => factor.normalized !== null).length,
  ]
}

/**
 * Колонки рейтинга вуза. Собственных показателей у вуза нет — балл сложен из
 * рейтингов его программ, поэтому учтённые считаются программами.
 */
export const UNIVERSITY_RATING_HEADERS = ['Рейтинг', 'Основание рейтинга', 'Учтено программ']

export function universityRatingCells(rating: UniversityRatingDto | null): CsvValue[] {
  if (!rating) return [null, METRIC_BASIS_LABELS.none, 0]
  return [rating.score, METRIC_BASIS_LABELS[rating.basis], rating.ratedProgramCount]
}

/** Колонки основного контакта в выгрузке вузов. Состав одинаков для всех ролей. */
export const CONTACT_HEADERS = ['Контактное лицо', 'Должность', 'Почта']

/**
 * Ячейки основного контакта. Почта — только ролям, которым она нужна для работы
 * (canSeeContactDetails): остальным колонка остаётся, но пустая — так файл
 * у всех ролей одного вида и цикл «выгрузил → загрузил» не ломается.
 * Телефон в выгрузку не попадает ни у кого: он есть в карточке вуза.
 */
export function contactCells(
  contact: { fullName: string; position: string | null; email: string | null } | undefined,
  showDetails: boolean,
): CsvValue[] {
  if (!contact) return [null, null, null]
  return [contact.fullName, contact.position, showDetails ? contact.email : null]
}

/** Фильтры со свободным текстом: в поиске может оказаться фамилия. */
const FREE_TEXT_FILTERS = new Set(['q'])
/** Служебные параметры списка — к набору выгруженных данных отношения не имеют. */
const PAGING_FILTERS = new Set(['page', 'pageSize'])

type AuditScalar = string | number | boolean | null
export type AuditFilterValue = AuditScalar | AuditScalar[]

/**
 * Фильтры выгрузки для журнала действий: что именно выгрузили, без персональных
 * данных. Значения перечислений, флагов и идентификаторов пишутся как есть —
 * по ним видно, какой срез базы ушёл в файл. Свободный текст поиска заменяется
 * признаком `true`: был отбор по строке, но какой — в журнал не попадает.
 */
export function auditFilters(
  filters: Readonly<Record<string, unknown>>,
): Record<string, AuditFilterValue> {
  const result: Record<string, AuditFilterValue> = {}
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || PAGING_FILTERS.has(key)) continue
    // Значения фильтров — уже проверенные схемой списка скаляры и их массивы.
    result[key] = FREE_TEXT_FILTERS.has(key) ? true : (value as AuditFilterValue)
  }
  return result
}
