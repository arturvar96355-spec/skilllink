import { readXlsx, writeXlsx, XLSX_CONTENT_TYPE } from '@/shared/files/xlsx'
import { toCsv, type CsvValue } from '@/modules/export/export.rules'

/**
 * Отчёты «по ТЗ» и «Каталог по ТЗ» (решение 145, п.7, п.8, п.10 функц. требований):
 * заголовки колонок — дословно из ТЗ, форматы — csv, xlsx, json (и печатный pdf
 * у существующего «Отчёта руководителю», это не серверный формат).
 *
 * xlsx — тот же писатель, что у файла для LMS (решение 132, `shared/files/xlsx.ts`):
 * новой зависимости нет, как и просил владелец.
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

export function reportCsv(payload: ReportPayload): string {
  return toCsv([...payload.columns], payload.rows as CsvValue[][])
}

const XLSX_SHEET_NAME = 'Отчёт'

export function reportXlsx(payload: ReportPayload, now: Date = new Date()): Buffer {
  return writeXlsx(
    [{ name: XLSX_SHEET_NAME, rows: [[...payload.columns], ...payload.rows], boldHeader: true }],
    now,
  )
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
