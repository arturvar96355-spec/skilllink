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

/**
 * Фильтры отчёта в адресе страницы (решение 172, `reports.schema.ts` на сервере —
 * та же форма параметров запроса, без `format`). Пустая строка — фильтр не задан,
 * так его хранит `useSearchParams`, а не `undefined`.
 */
export interface ReportFilterValues {
  dateFrom: string
  dateTo: string
  universityId: string
  programId: string
  productId: string
  responsibleId: string
  status: string
}

export const EMPTY_REPORT_FILTERS: ReportFilterValues = {
  dateFrom: '',
  dateTo: '',
  universityId: '',
  programId: '',
  productId: '',
  responsibleId: '',
  status: '',
}

/** Фильтры как параметры запроса: пустые убраны, `format` сервер принимает и без даты/времени. */
function filterParams(filters: ReportFilterValues): Record<string, string | undefined> {
  return {
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    universityId: filters.universityId || undefined,
    programId: filters.programId || undefined,
    productId: filters.productId || undefined,
    responsibleId: filters.responsibleId || undefined,
    status: filters.status || undefined,
  }
}

/** Ссылка на файл отчёта в выбранном формате и с текущими фильтрами. */
export function reportFileHref(endpoint: string, format: ReportFormat, filters: ReportFilterValues): string {
  return `${endpoint}${buildQuery({ ...filterParams(filters), format })}`
}

/** Путь превью — тот же файл `?format=json`, но без скачивания (см. `useReportPreview`). */
export function reportPreviewPath(endpoint: string, filters: ReportFilterValues): string {
  return `${endpoint}${buildQuery({ ...filterParams(filters), format: 'json' })}`
}

/** Хоть один фильтр задан — кнопка «Сбросить фильтры» показывается. */
export function hasReportFilters(filters: ReportFilterValues): boolean {
  return Object.values(filters).some((value) => value !== '')
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

/** Подписи выбранных фильтров — для строки под заголовком листа и его печати. */
export interface ReportFilterLabels {
  universityName?: string
  programName?: string
  productName?: string
  responsibleName?: string
  statusLabel?: string
}

/**
 * «Фильтры: период 01.01.2026 — 30.06.2026 · вуз «СПбГУТ» · статус «В работе»» —
 * тот же вид, что и у строки-заголовка файла (`reportFiltersSummary` на сервере,
 * `reports.rules.ts`), но с именами из уже открытых карточек вуза/программы/продукта/
 * ответственного, а не с их id. Показывается и на экране, и на печати (задание,
 * «Печать / PDF» показывает выбранные фильтры в шапке печати).
 */
export function reportFiltersLine(filters: ReportFilterValues, labels: ReportFilterLabels): string | null {
  const parts: string[] = []
  if (filters.dateFrom || filters.dateTo) {
    const from = filters.dateFrom ? formatDate(filters.dateFrom) : '…'
    const to = filters.dateTo ? formatDate(filters.dateTo) : '…'
    parts.push(`период ${from} — ${to}`)
  }
  if (filters.universityId) parts.push(`вуз «${labels.universityName ?? '…'}»`)
  if (filters.programId) parts.push(`ИТ-направление «${labels.programName ?? '…'}»`)
  if (filters.productId) parts.push(`ИТ-продукт «${labels.productName ?? '…'}»`)
  if (filters.responsibleId) parts.push(`ответственный «${labels.responsibleName ?? '…'}»`)
  if (filters.status) parts.push(`статус «${labels.statusLabel ?? filters.status}»`)
  return parts.length > 0 ? `Фильтры: ${parts.join(' · ')}` : null
}
