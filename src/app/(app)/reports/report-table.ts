import { buildQuery } from '@/ui/lib/api'
import { NO_DATA, formatDate, formatDateTime, pluralize } from '@/ui/lib/format'

/**
 * Отчёт по ТЗ и Каталог по ТЗ (решение 145 — API, решение 150 — экран).
 *
 * Общая логика двух почти одинаковых по устройству экранов: колонки и строки
 * приходят с сервера уже готовыми (`GET /api/reports/tz|catalog?format=json`),
 * фронт только показывает таблицу-превью и собирает ссылки на выгрузку —
 * поэтому вынесено отдельно от компонента и без React, как у отчёта
 * руководителю (`reports/portfolio/report.ts`).
 */

export const REPORT_FORMATS = ['csv', 'xlsx', 'json'] as const
export type ReportFormat = (typeof REPORT_FORMATS)[number]

export const REPORT_FORMAT_LABELS: Record<ReportFormat, string> = {
  csv: 'CSV',
  xlsx: 'XLSX',
  json: 'JSON',
}

/** Схема `json`-ответа отчёта — та же форма, что отдаёт `reportJsonBody` на сервере. */
export interface ReportJsonPayload {
  generatedAt: string
  filters: Record<string, unknown>
  columns: readonly string[]
  rows: readonly (string | number | null)[][]
}

/** Ссылка на файл отчёта в выбранном формате — та же, что у кнопки «Выгрузить» реестра связок. */
export function reportFileHref(endpoint: string, format: ReportFormat): string {
  return `${endpoint}${buildQuery({ format })}`
}

/** Значение ячейки превью: пустая строка и `null` — это «Нет данных», а не пустое место. */
export function reportCellText(value: string | number | null): string {
  if (value === null) return NO_DATA
  if (typeof value === 'string' && value.trim() === '') return NO_DATA
  return String(value)
}

/** «Сформирован 26.09.2026, 14:05 (МСК)» — под заголовком листа. */
export function reportGeneratedLine(generatedAt: string): string {
  return `Сформирован ${formatDateTime(generatedAt)} (МСК)`
}

/** «38 строк»; ни одной строки — отдельным текстом решает сам экран (пусто ≠ ошибка). */
export function reportRowsSummary(count: number): string {
  return `${count} ${pluralize(count, ['строка', 'строки', 'строк'])}`
}

/** Заголовок вкладки на время страницы — имя файла в «Сохранить как PDF» (как у решения 97). */
export function reportPrintTitle(label: string, generatedAt: string): string {
  return `${label} SkillLink ${formatDate(generatedAt)}`
}
