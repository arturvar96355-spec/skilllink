import { readXlsx, writeXlsx, XLSX_CONTENT_TYPE } from '@/shared/files/xlsx'
import { escapeCsvValue, toCsv, UTF8_BOM, type CsvValue } from '@/modules/export/export.rules'
import { COOPERATION_STATUS_LABELS } from '@/shared/contracts/labels'
import type { ReportFilterLabels } from './reports.repo'
import type { ReportFilters } from './reports.schema'

/**
 * Отчёты «по ТЗ» и «Каталог по ТЗ» (решение 145, п.7, п.8, п.10 функц. требований):
 * заголовки колонок — дословно из ТЗ, форматы — csv, xlsx, json (и печатный pdf
 * у существующего «Отчёта руководителю», это не серверный формат).
 *
 * xlsx — тот же писатель, что у файла для LMS (решение 132, `shared/files/xlsx.ts`):
 * новой зависимости нет, как и просил владелец.
 *
 * Фильтры отчётов (решение 172, `reports.schema.ts`) отражаются в файле двумя
 * способами: строкой-заголовком в csv/xlsx (`reportFiltersSummary`) и хвостом
 * имени файла с периодом и статусом (`reportFileNameSuffix`); в json — полем
 * `filters`, как и раньше.
 */

/** Колонки отчёта п.7 — дословно и в этом порядке (ТЗ, раздел «Отчёт»). */
export const TZ_REPORT_HEADERS = [
  'Наименование вуза',
  'ИТ-направление',
  'ИТ-продукт',
  'Статус работы с вузом',
  'Ответственный',
] as const

/** Колонки каталога п.8 — дословно и в этом порядке (ТЗ, раздел «Каталог»). */
export const CATALOG_REPORT_HEADERS = [
  'Название вуза',
  'Вендор',
  'ПО',
  'Номер договора',
  'Подписание лицензии',
  'Срок действия лицензии (год)',
  'Статус по передаче',
  'ФИО менеджера',
  'Ответственные от вуза',
  'Комментарий',
] as const

export type ReportCellValue = string | number | null

export interface ReportPayload {
  columns: readonly string[]
  rows: readonly ReportCellValue[][]
}

/** Схема json-файла отчёта (ТЗ, требования к решению п.4: результирующий json-файл). */
export interface ReportJsonBody {
  generatedAt: string
  filters: Record<string, unknown>
  columns: readonly string[]
  rows: readonly ReportCellValue[][]
}

export function reportJsonBody(
  payload: ReportPayload,
  filters: Record<string, unknown>,
  now: Date = new Date(),
): ReportJsonBody {
  return { generatedAt: now.toISOString(), filters, columns: payload.columns, rows: payload.rows }
}

/**
 * `summaryLine` — строка-заголовок с применёнными фильтрами (решение 172, задание
 * «фильтры попадают в имя файла или в строку-заголовка»): без фильтров ничего не
 * меняется — та же строка, что и раньше, круговой тест это проверяет.
 */
export function reportCsv(payload: ReportPayload, summaryLine?: string | null): string {
  const csv = toCsv([...payload.columns], payload.rows as CsvValue[][])
  if (!summaryLine) return csv
  return `${UTF8_BOM}${escapeCsvValue(summaryLine)}\r\n${csv.slice(UTF8_BOM.length)}`
}

const XLSX_SHEET_NAME = 'Отчёт'

export function reportXlsx(payload: ReportPayload, now: Date = new Date(), summaryLine?: string | null): Buffer {
  const rows = summaryLine
    ? [[summaryLine], [...payload.columns], ...payload.rows]
    : [[...payload.columns], ...payload.rows]
  return writeXlsx([{ name: XLSX_SHEET_NAME, rows, boldHeader: true }], now)
}

/**
 * Круговой тест своим читателем (задание, п.10): то, что написал `reportXlsx`,
 * читается назад тем же `readXlsx` — строка заголовков и данных совпадают с тем,
 * что просили записать.
 */
export function readReportXlsxRows(buffer: Buffer): string[][] {
  const [sheet] = readXlsx(buffer)
  return sheet ? sheet.rows : []
}

export { XLSX_CONTENT_TYPE }

/** «01.01.2026» из «2026-01-01…» (голова ISO-строки, дата в любом часовом поясе не нужна). */
function ruDatePart(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-')
  return `${day}.${month}.${year}`
}

/**
 * Строка-заголовок применённых фильтров (решение 172): «Фильтры: период 01.01.2026 —
 * 30.06.2026 · вуз «СПбГУТ» · статус «В работе»». `null` — фильтров нет вовсе,
 * и файл выглядит так же, как до решения 172.
 *
 * Имена вуза/программы/продукта/ответственного — из `resolveFilterLabels`
 * (`reports.repo.ts`); фильтр без резолвнутого имени (вуз вне доступа
 * представителя, или запись успели удалить) показывает id — это лучше, чем
 * молча потерять часть шапки.
 */
export function reportFiltersSummary(filters: ReportFilters, labels: ReportFilterLabels): string | null {
  const parts: string[] = []
  if (filters.dateFrom || filters.dateTo) {
    const from = filters.dateFrom ? ruDatePart(filters.dateFrom) : '…'
    const to = filters.dateTo ? ruDatePart(filters.dateTo) : '…'
    parts.push(`период ${from} — ${to}`)
  }
  if (filters.universityId) parts.push(`вуз «${labels.universityName ?? filters.universityId}»`)
  if (filters.programId) parts.push(`ИТ-направление «${labels.programName ?? filters.programId}»`)
  if (filters.productId) parts.push(`ИТ-продукт «${labels.productName ?? filters.productId}»`)
  if (filters.responsibleId) parts.push(`ответственный «${labels.responsibleName ?? filters.responsibleId}»`)
  if (filters.status) parts.push(`статус «${COOPERATION_STATUS_LABELS[filters.status]}»`)

  return parts.length > 0 ? `Фильтры: ${parts.join(' · ')}` : null
}

/**
 * Хвост имени файла с датами периода и статусом (решение 172) — то, что можно
 * прочитать без карточек справочников. Вуз/программа/продукт/ответственный —
 * идентификаторы, а не текст, поэтому в имя файла не идут: они читаются
 * в строке-заголовке файла (`reportFiltersSummary`) и в поле `filters` json-файла.
 */
export function reportFileNameSuffix(filters: ReportFilters): string {
  const parts: string[] = []
  if (filters.dateFrom) parts.push(`from-${filters.dateFrom.slice(0, 10)}`)
  if (filters.dateTo) parts.push(`to-${filters.dateTo.slice(0, 10)}`)
  if (filters.status) parts.push(`status-${filters.status.toLowerCase().replace(/_/g, '-')}`)
  return parts.length > 0 ? `_${parts.join('_')}` : ''
}
