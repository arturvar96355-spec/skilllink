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
 * «Нет данных» — пустой балл, а не ноль (решение 8).
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
