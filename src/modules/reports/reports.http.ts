import {
  reportCsv,
  reportFileNameSuffix,
  reportFiltersSummary,
  reportJsonBody,
  reportXlsx,
  XLSX_CONTENT_TYPE,
  type ReportPayload,
} from './reports.rules'
import type { ReportFilterLabels } from './reports.repo'
import type { ReportFilters, ReportFormat } from './reports.schema'

/**
 * Ответ-файл отчёта в выбранном формате (решение 145, п.10: csv, xlsx, json).
 * `no-store`: в отчётах — ФИО и рабочие данные вузов, кэшировать их не нужно ни
 * браузеру, ни промежуточным узлам (тот же принцип, что у выгрузки ПД, dsar.http.ts).
 *
 * Фильтры (решение 172) попадают и в имя файла (период, статус — `reportFileNameSuffix`),
 * и в строку-заголовок csv/xlsx (`reportFiltersSummary`), и в поле `filters` json-файла.
 */
export function reportFileResponse(
  prefix: string,
  payload: ReportPayload,
  format: ReportFormat,
  filters: ReportFilters,
  filterLabels: ReportFilterLabels,
  now: Date = new Date(),
): Response {
  const stamp = now.toISOString().slice(0, 10)
  const suffix = reportFileNameSuffix(filters)
  const summaryLine = reportFiltersSummary(filters, filterLabels)
  const commonHeaders = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }

  if (format === 'xlsx') {
    const fileName = `skilllink-${prefix}-${stamp}${suffix}.xlsx`
    return new Response(new Uint8Array(reportXlsx(payload, now, summaryLine)), {
      status: 200,
      headers: {
        ...commonHeaders,
        'content-type': XLSX_CONTENT_TYPE,
        'content-disposition': `attachment; filename="${fileName}"`,
      },
    })
  }

  if (format === 'json') {
    const fileName = `skilllink-${prefix}-${stamp}${suffix}.json`
    return new Response(JSON.stringify(reportJsonBody(payload, filters, now), null, 2), {
      status: 200,
      headers: {
        ...commonHeaders,
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${fileName}"`,
      },
    })
  }

  const fileName = `skilllink-${prefix}-${stamp}${suffix}.csv`
  return new Response(reportCsv(payload, summaryLine), {
    status: 200,
    headers: {
      ...commonHeaders,
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${fileName}"`,
    },
  })
}
