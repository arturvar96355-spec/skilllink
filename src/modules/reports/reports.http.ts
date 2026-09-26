import { XLSX_CONTENT_TYPE, reportCsv, reportJsonBody, reportXlsx, type ReportPayload } from './reports.rules'
import type { ReportFormat } from './reports.schema'

/**
 * Ответ-файл отчёта в выбранном формате (решение 145, п.10: csv, xlsx, json).
 * `no-store`: в отчётах — ФИО и рабочие данные вузов, кэшировать их не нужно ни
 * браузеру, ни промежуточным узлам (тот же принцип, что у выгрузки ПД, dsar.http.ts).
 */
export function reportFileResponse(
  prefix: string,
  payload: ReportPayload,
  format: ReportFormat,
  now: Date = new Date(),
): Response {
  const stamp = now.toISOString().slice(0, 10)
  const commonHeaders = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }

  if (format === 'xlsx') {
    const fileName = `skilllink-${prefix}-${stamp}.xlsx`
    return new Response(new Uint8Array(reportXlsx(payload, now)), {
      status: 200,
      headers: {
        ...commonHeaders,
        'content-type': XLSX_CONTENT_TYPE,
        'content-disposition': `attachment; filename="${fileName}"`,
      },
    })
  }

  if (format === 'json') {
    const fileName = `skilllink-${prefix}-${stamp}.json`
    return new Response(JSON.stringify(reportJsonBody(payload, {}, now), null, 2), {
      status: 200,
      headers: {
        ...commonHeaders,
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${fileName}"`,
      },
    })
  }

  const fileName = `skilllink-${prefix}-${stamp}.csv`
  return new Response(reportCsv(payload), {
    status: 200,
    headers: {
      ...commonHeaders,
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${fileName}"`,
    },
  })
}
