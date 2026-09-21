/**
 * Выгрузка реестров в CSV (раздел 20 ТЗ, приоритет P2).
 *
 * Формат рассчитан на Excel: разделитель — точка с запятой, кодировка UTF-8 с BOM.
 * Без BOM Excel на Windows открывает кириллицу кракозябрами, и выгрузка становится
 * бесполезной ровно для тех, кому она нужна.
 */

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
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''

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
