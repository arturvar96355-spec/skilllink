import { validationError } from '@/shared/http/errors'
import { readZip, writeZip, type ZipEntry } from './zip'

/**
 * Минимальное чтение и запись книг Excel (.xlsx) без зависимостей (решение 132).
 *
 * Чтение: листы по порядку книги, ячейки как текст — общие строки (sharedStrings),
 * строки прямо в ячейке (inlineStr), числа, логические значения, значения формул.
 * Стили, даты как даты, объединённые ячейки не разбираются: загрузке нужен текст
 * ячеек, а не вид таблицы.
 *
 * Запись: книга из нескольких листов, строки через таблицу общих строк (как делает
 * Excel), числа, жирная строка заголовков, ширина колонок, списки допустимых
 * значений (проверка данных). Метаданные автора не пишутся: в docProps — только
 * название программы.
 *
 * Формулы не пишутся вовсе: строка «=…» ложится в ячейку текстом (t="s") и Excel
 * её не вычисляет — внедрение формул через xlsx, в отличие от CSV, невозможно.
 */

// ─────────────────────────────── XML ───────────────────────────────

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Управляющие символы в XML 1.0 недопустимы — кроме табуляции и переводов строки.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
}

const NAMED_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x')) return String.fromCodePoint(Number.parseInt(body.slice(2), 16))
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10))
    return NAMED_ENTITIES[body] ?? whole
  })
}

function attributes(source: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const match of source.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    // Префикс пространства имён остаётся в имени: «r:id» у листа книги — это не «Id» связи.
    const key = match[1]!
    result[key] = decodeXml(match[2] ?? match[3] ?? '')
  }
  return result
}

/**
 * Текст элемента: все `<t>` внутри, кроме фонетических подсказок `<rPh>`
 * (японская разметка чтения — в значение ячейки не входит).
 */
function textRuns(xml: string): string {
  const withoutPhonetic = xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '')
  let text = ''
  for (const match of withoutPhonetic.matchAll(/<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g)) {
    text += decodeXml(match[1] ?? '')
  }
  return text
}

// ─────────────────────────────── Чтение ───────────────────────────────

export interface XlsxSheet {
  name: string
  /** Строки по порядку, ячейки по колонкам; пропуски — пустые строки. */
  rows: string[][]
}

export interface ReadXlsxLimits {
  maxRows: number
  maxColumns: number
}

const DEFAULT_READ_LIMITS: ReadXlsxLimits = { maxRows: 10_000, maxColumns: 200 }

const notXlsx = (message: string) =>
  validationError('Файл не похож на книгу Excel (.xlsx)', [{ field: 'file', message }])

/** «AE» → 30 (с нуля). */
export function columnIndex(letters: string): number {
  let index = 0
  for (const char of letters.toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64)
  return index - 1
}

/** 30 → «AE». */
export function columnName(index: number): string {
  let n = index + 1
  let name = ''
  while (n > 0) {
    const rest = (n - 1) % 26
    name = String.fromCharCode(65 + rest) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

function resolveTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = `xl/${target}`.split('/')
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '..') resolved.pop()
    else if (part !== '.') resolved.push(part)
  }
  return resolved.join('/')
}

function readSharedStrings(files: Map<string, Buffer>, path: string | undefined): string[] {
  const xml = files.get(path ?? 'xl/sharedStrings.xml')?.toString('utf8')
  if (!xml) return []
  return [...xml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>|<(?:\w+:)?si\b[^>]*\/>/g)].map((match) =>
    textRuns(match[1] ?? ''),
  )
}

/** Значение числовой ячейки без экспоненты: 7.9990234365E10 → «79990234365». */
function numericText(raw: string): string {
  if (!/e/i.test(raw)) return raw
  const value = Number(raw)
  return Number.isFinite(value) ? String(value) : raw
}

function readSheetRows(xml: string, shared: readonly string[], limits: ReadXlsxLimits): string[][] {
  const rows: string[][] = []
  const rowPattern = /<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g
  const cellPattern = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g
  let nextRow = 0

  for (const rowMatch of xml.matchAll(rowPattern)) {
    const rowAttrs = attributes(rowMatch[1] ?? '')
    const rowIndex = rowAttrs.r ? Number(rowAttrs.r) - 1 : nextRow
    nextRow = rowIndex + 1
    if (rowIndex >= limits.maxRows) {
      throw notXlsx(`На листе больше ${limits.maxRows} строк — разделите файл`)
    }

    const cells: string[] = []
    let nextColumn = 0
    for (const cellMatch of (rowMatch[2] ?? '').matchAll(cellPattern)) {
      const cellAttrs = attributes(cellMatch[1] ?? '')
      const ref = cellAttrs.r ? /^([A-Za-z]+)/.exec(cellAttrs.r)?.[1] : undefined
      const column = ref ? columnIndex(ref) : nextColumn
      nextColumn = column + 1
      if (column >= limits.maxColumns) continue

      const body = cellMatch[2] ?? ''
      const valueMatch = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body)
      const value = valueMatch ? decodeXml(valueMatch[1]!) : ''
      let text: string
      switch (cellAttrs.t) {
        case 's':
          text = shared[Number(value)] ?? ''
          break
        case 'inlineStr':
          text = textRuns(/<(?:\w+:)?is\b[^>]*>([\s\S]*?)<\/(?:\w+:)?is>/.exec(body)?.[1] ?? '')
          break
        case 'b':
          text = value === '1' ? 'ИСТИНА' : value === '0' ? 'ЛОЖЬ' : value
          break
        case 'str':
        case 'e':
          text = value
          break
        default:
          text = numericText(value)
      }
      while (cells.length < column) cells.push('')
      cells[column] = text
    }

    while (rows.length < rowIndex) rows.push([])
    rows[rowIndex] = cells
  }

  return rows
}

/** Читает все листы книги по порядку. */
export function readXlsx(bytes: Uint8Array, limits: ReadXlsxLimits = DEFAULT_READ_LIMITS): XlsxSheet[] {
  const files = readZip(bytes)
  const workbook = files.get('xl/workbook.xml')?.toString('utf8')
  if (!workbook) throw notXlsx('В архиве нет xl/workbook.xml — это не книга Excel')

  const relsXml = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? ''
  const targets = new Map<string, { target: string; type: string }>()
  for (const match of relsXml.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?>/g)) {
    const attrs = attributes(match[1] ?? '')
    if (attrs.Id && attrs.Target) targets.set(attrs.Id, { target: attrs.Target, type: attrs.Type ?? '' })
  }
  const sharedTarget = [...targets.values()].find((rel) => rel.type.endsWith('/sharedStrings'))
  const shared = readSharedStrings(files, sharedTarget ? resolveTarget(sharedTarget.target) : undefined)

  const sheets: XlsxSheet[] = []
  for (const match of workbook.matchAll(/<(?:\w+:)?sheet\b([^>]*?)\/?>/g)) {
    const attrs = attributes(match[1] ?? '')
    const relId = attrs['r:id'] ?? Object.entries(attrs).find(([key]) => key.endsWith(':id'))?.[1]
    const rel = relId ? targets.get(relId) : undefined
    const xml = rel ? files.get(resolveTarget(rel.target))?.toString('utf8') : undefined
    if (!xml) continue
    sheets.push({ name: attrs.name ?? `Лист${sheets.length + 1}`, rows: readSheetRows(xml, shared, limits) })
  }

  if (sheets.length === 0) throw notXlsx('В книге не найдено ни одного листа')
  return sheets
}

// ─────────────────────────────── Запись ───────────────────────────────

export type XlsxCellValue = string | number | null | undefined

export interface XlsxDataValidation {
  /** Диапазон ячеек, например «L1:L1001». */
  sqref: string
  /** Источник списка, например «Лист2!$A$1:$A$2». */
  listSource: string
}

export interface XlsxSheetInput {
  name: string
  rows: XlsxCellValue[][]
  /** Первая строка — заголовок, жирным шрифтом. */
  boldHeader?: boolean
  /** Ширина колонок в символах, по порядку. */
  columnWidths?: number[]
  validations?: XlsxDataValidation[]
}

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

const STYLES_XML =
  `${XML_HEAD}<styleSheet xmlns="${MAIN_NS}">` +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Обычный" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>'

/** Имя листа по правилам Excel: до 31 знака, без []:*?/\. */
function assertSheetName(name: string): void {
  if (name.length === 0 || name.length > 31 || /[[\]:*?/\\]/.test(name)) {
    throw new Error(`Недопустимое имя листа Excel: ${name}`)
  }
}

function sheetXml(sheet: XlsxSheetInput, stringIndex: (text: string) => number): string {
  const rowsXml: string[] = []
  let maxColumn = 0
  sheet.rows.forEach((row, rowIndex) => {
    const cells: string[] = []
    row.forEach((value, columnIndexValue) => {
      if (value === null || value === undefined || value === '') return
      const ref = `${columnName(columnIndexValue)}${rowIndex + 1}`
      const style = sheet.boldHeader && rowIndex === 0 ? ' s="1"' : ''
      maxColumn = Math.max(maxColumn, columnIndexValue + 1)
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) return
        cells.push(`<c r="${ref}"${style}><v>${value}</v></c>`)
      } else {
        cells.push(`<c r="${ref}"${style} t="s"><v>${stringIndex(value)}</v></c>`)
      }
    })
    rowsXml.push(`<row r="${rowIndex + 1}">${cells.join('')}</row>`)
  })

  const lastRow = Math.max(sheet.rows.length, 1)
  const dimension = `A1:${columnName(Math.max(maxColumn, 1) - 1)}${lastRow}`
  const cols = sheet.columnWidths?.length
    ? `<cols>${sheet.columnWidths
        .map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`)
        .join('')}</cols>`
    : ''
  const validations = sheet.validations?.length
    ? `<dataValidations count="${sheet.validations.length}">${sheet.validations
        .map(
          (rule) =>
            `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${escapeXml(rule.sqref)}">` +
            `<formula1>${escapeXml(rule.listSource)}</formula1></dataValidation>`,
        )
        .join('')}</dataValidations>`
    : ''

  return (
    `${XML_HEAD}<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">` +
    `<dimension ref="${dimension}"/>` +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    cols +
    `<sheetData>${rowsXml.join('')}</sheetData>` +
    validations +
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
    '</worksheet>'
  )
}

/** Собирает книгу Excel. Порядок листов — порядок во входе; активен первый. */
export function writeXlsx(sheets: readonly XlsxSheetInput[], now: Date = new Date()): Buffer {
  if (sheets.length === 0) throw new Error('В книге должен быть хотя бы один лист')
  for (const sheet of sheets) assertSheetName(sheet.name)

  const strings: string[] = []
  const indexOf = new Map<string, number>()
  let stringRefs = 0
  const stringIndex = (text: string): number => {
    stringRefs += 1
    const existing = indexOf.get(text)
    if (existing !== undefined) return existing
    strings.push(text)
    indexOf.set(text, strings.length - 1)
    return strings.length - 1
  }

  const sheetFiles = sheets.map((sheet) => sheetXml(sheet, stringIndex))

  const sharedStrings =
    `${XML_HEAD}<sst xmlns="${MAIN_NS}" count="${stringRefs}" uniqueCount="${strings.length}">` +
    strings
      .map((text) => {
        const space = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : ''
        return `<si><t${space}>${escapeXml(text)}</t></si>`
      })
      .join('') +
    '</sst>'

  const workbook =
    `${XML_HEAD}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">` +
    '<bookViews><workbookView/></bookViews><sheets>' +
    sheets
      .map((sheet, i) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('') +
    '</sheets></workbook>'

  const n = sheets.length
  const workbookRels =
    `${XML_HEAD}<Relationships xmlns="${PKG_REL_NS}">` +
    sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join('') +
    `<Relationship Id="rId${n + 1}" Type="${REL_NS}/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId${n + 2}" Type="${REL_NS}/sharedStrings" Target="sharedStrings.xml"/>` +
    '</Relationships>'

  const rootRels =
    `${XML_HEAD}<Relationships xmlns="${PKG_REL_NS}">` +
    `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>` +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    `<Relationship Id="rId3" Type="${REL_NS}/extended-properties" Target="docProps/app.xml"/>` +
    '</Relationships>'

  const contentTypes =
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>'

  // Автора в свойствах файла нет намеренно: у файлов организаторов там ФИО
  // сотрудника и путь к его папке — это утечка, которую мы не повторяем.
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z')
  const core =
    `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified>` +
    '</cp:coreProperties>'
  const app =
    `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">` +
    '<Application>SkillLink</Application></Properties>'

  const utf8 = (text: string) => Buffer.from(text, 'utf8')
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: utf8(contentTypes) },
    { name: '_rels/.rels', data: utf8(rootRels) },
    { name: 'docProps/core.xml', data: utf8(core) },
    { name: 'docProps/app.xml', data: utf8(app) },
    { name: 'xl/workbook.xml', data: utf8(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: utf8(workbookRels) },
    { name: 'xl/styles.xml', data: utf8(STYLES_XML) },
    { name: 'xl/sharedStrings.xml', data: utf8(sharedStrings) },
    ...sheetFiles.map((xml, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: utf8(xml) })),
  ]
  return writeZip(entries)
}

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
