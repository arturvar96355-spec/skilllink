import { validationError } from '@/shared/http/errors'
import { PG_INT_MAX } from '@/shared/db/storable'
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
  // Иначе предпросмотр обещал «Будет создан», а запись падала: колонка столько не вмещает.
  if (parsed > PG_INT_MAX) {
    return { error: `Колонка «${name}»: число ${raw} слишком большое` }
  }
  return { value: parsed }
}

/**
 * Поля из колонок, которые есть в файле.
 *
 * Колонки нет — поле не трогается; колонка есть, а ячейка пустая — осознанное
 * «нет данных», поле очищается. Правило общее для вузов и программ: у вузов его
 * ввели, когда файл с одними обязательными колонками молча стирал сайт
 * и численность, а у программ забыли — и тот же файл стирал код, направление,
 * длительность и все три показателя рейтинга.
 */
export function presentColumns<T extends Record<string, unknown>>(
  index: Map<string, number>,
  columns: { [K in keyof T]: string },
  values: T,
): Partial<T> {
  const result: Partial<T> = {}
  for (const key of Object.keys(columns) as Array<keyof T>) {
    if (index.has(columns[key])) result[key] = values[key]
  }
  return result
}

/**
 * Текст ошибки строки по отказу схемы API — с названием колонки, а не поля.
 *
 * Импорт проверял строки своими правилами, а API — своими: через файл можно было
 * завести вуз с названием из одной буквы, сайтом «не-ссылка» или программу
 * длительностью в тысячу месяцев. Теперь строки проверяются теми же схемами.
 */
export function schemaIssue(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
  columnOf: Record<string, string>,
): string {
  const issue = issues[0]
  if (!issue) return 'Строка не прошла проверку'
  const field = String(issue.path[0] ?? '')
  const column = columnOf[field]
  return column ? `Колонка «${column}»: ${issue.message}` : issue.message
}

