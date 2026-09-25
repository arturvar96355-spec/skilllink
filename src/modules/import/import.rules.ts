import { validationError } from '@/shared/http/errors'
import { PG_INT_MAX } from '@/shared/db/storable'
import { CSV_DELIMITER } from '@/modules/export/export.rules'

/**
 * Разбор CSV из Excel.
 *
 * Пишется вручную, а не берётся библиотекой: формат нужен ровно тот, который отдаёт
 * наша же выгрузка — точка с запятой, кавычки, BOM — плюс запятая, которую ставят
 * Excel с английскими настройками и Google Таблицы. Зависимость ради тридцати строк
 * пришлось бы обосновывать, а проверить разбор тестами дешевле.
 */

const BOM = '﻿'

/** Разделители, которые понимает загрузка. */
export const CSV_DELIMITERS = [CSV_DELIMITER, ','] as const
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number]

/**
 * Разделитель файла — по строке заголовков.
 *
 * Русский Excel сохраняет CSV через точку с запятой, английский и Google Таблицы —
 * через запятую. Файл через запятую, разобранный по точке с запятой, читается одной
 * колонкой, и человек получает «не найдены: Название, Город, Регион».
 * Считаются разделители вне кавычек: запятая внутри «"Москва, Россия"» — часть
 * значения. При равенстве — точка с запятой: это формат нашей выгрузки.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const source = text.startsWith(BOM) ? text.slice(BOM.length) : text
  const counts = { [CSV_DELIMITER]: 0, ',': 0 } as Record<CsvDelimiter, number>
  let inQuotes = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (inQuotes) continue
    if (char === '\n' || char === '\r') break
    if (char === CSV_DELIMITER || char === ',') counts[char] += 1
  }

  return counts[','] > counts[CSV_DELIMITER] ? ',' : CSV_DELIMITER
}

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
    // Одна колонка на весь заголовок — почти всегда чужой разделитель, а не
    // пропавшие колонки: об этом и надо сказать.
    const oneColumn =
      header.length === 1
        ? '. Файл прочитан одной колонкой — разделитель колонок должен быть «;» или «,»'
        : ''
    throw validationError('В файле не хватает обязательных колонок', [
      { field: 'csv', message: `Не найдены: ${missing.join(', ')}${oneColumn}` },
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
  // Иначе предпросмотр пообещал бы «Будет создан», а запись упала бы: колонка столько не вмещает.
  if (parsed > PG_INT_MAX) {
    return { error: `Колонка «${name}»: число ${raw} слишком большое` }
  }
  return { value: parsed }
}

/**
 * Поля из колонок, которые есть в файле.
 *
 * Колонки нет — поле не трогается; колонка есть, а ячейка пустая — осознанное
 * «нет данных», поле очищается. Правило общее для вузов и программ: иначе файл
 * с одними обязательными колонками молча стёр бы у вуза сайт и численность,
 * а у программы — код, направление, длительность и все три показателя рейтинга.
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
 * Строки файла проверяются теми же схемами, что и запросы API: со своими правилами
 * через файл можно было бы завести вуз с названием из одной буквы, сайтом
 * «не-ссылка» или программу длительностью в тысячу месяцев.
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


/**
 * Какие колонки строки меняют запись — по сравнению с тем, что уже в базе.
 *
 * Без сравнения предпросмотр обещал бы «Обновятся данные» каждой найденной
 * записи, и повторная загрузка только что выгруженного файла выглядела бы
 * как правка всего реестра. Сравниваются только поля из файла: колонки,
 * которой нет, загрузка не трогает.
 */
export function changedColumns(
  existing: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
  columnOf: Readonly<Record<string, string>>,
): string[] {
  return Object.keys(next)
    .filter((key) => (existing[key] ?? null) !== (next[key] ?? null))
    .map((key) => columnOf[key] ?? key)
}
