import { validationError } from '@/shared/http/errors'
import { CSV_DELIMITER } from '@/modules/export/export.rules'

/**
 * Разбор CSV из Excel.
 *
 * Пишется вручную, а не берётся библиотекой: формат нужен ровно тот, который отдаёт
 * наша же выгрузка — точка с запятой, кавычки, BOM. Зависимость ради тридцати строк
 * пришлось бы обосновывать, а проверить разбор тестами дешевле.
 */

const BOM = '﻿'

/** Одна строка файла как массив ячеек. */
export type CsvRow = string[]

/**
 * Разбирает текст CSV.
 *
 * Учитывает: BOM в начале, кавычки вокруг значений, удвоенные кавычки внутри,
 * переносы строк внутри кавычек, окончания строк CRLF и LF.
 */
export function parseCsv(text: string, delimiter = CSV_DELIMITER): CsvRow[] {
  const source = text.startsWith(BOM) ? text.slice(BOM.length) : text

  const rows: CsvRow[] = []
  let row: CsvRow = []
  let field = ''
  let inQuotes = false

  const endField = (): void => {
    row.push(field)
    field = ''
  }
  const endRow = (): void => {
    endField()
    // Пустые строки в конце файла игнорируются: текстовые редакторы их добавляют сами.
    if (row.length > 1 || row[0] !== '') rows.push(row)
    row = []
  }

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]

    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"' && field === '') {
      inQuotes = true
    } else if (char === delimiter) {
      endField()
    } else if (char === '\r') {
      // CRLF: перевод строки обработается следующим символом.
      if (source[index + 1] === '\n') index += 1
      endRow()
    } else if (char === '\n') {
      endRow()
    } else {
      field += char
    }
  }

  if (field !== '' || row.length > 0) endRow()

  return rows
}

/**
 * Сопоставляет заголовки файла с ожидаемыми колонками.
 *
 * Колонки ищутся по названию, а не по порядку: человек, правивший файл в Excel,
 * запросто поменяет их местами, и импорт по позициям тихо запишет город в регион.
 */
export function mapHeaders(
  header: CsvRow,
  required: readonly string[],
  optional: readonly string[] = [],
): Map<string, number> {
  const normalized = header.map((cell) => cell.trim().toLowerCase())
  const index = new Map<string, number>()

  for (const name of [...required, ...optional]) {
    const position = normalized.indexOf(name.toLowerCase())
    if (position >= 0) index.set(name, position)
  }

  const missing = required.filter((name) => !index.has(name))
  if (missing.length > 0) {
    throw validationError('В файле не хватает обязательных колонок', [
      { field: 'csv', message: `Не найдены: ${missing.join(', ')}` },
    ])
  }

  return index
}

export function cell(row: CsvRow, index: Map<string, number>, name: string): string | null {
  const position = index.get(name)
  if (position === undefined) return null
  const value = row[position]
  if (value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Число из ячейки.
 *
 * Пустая ячейка — это «Нет данных» (null), а не ноль. Нечисловое значение — ошибка
 * строки, а не молчаливый ноль: иначе опечатка в файле превратится в показатель.
 */
export function numericCell(
  row: CsvRow,
  index: Map<string, number>,
  name: string,
): { value: number | null } | { error: string } {
  const raw = cell(row, index, name)
  if (raw === null) return { value: null }

  const normalized = raw.replace(/\s/g, '').replace(',', '.')
  const parsed = Number(normalized)

  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    return { error: `Колонка «${name}»: ожидалось целое число, получено «${raw}»` }
  }
  return { value: parsed }
}
