import { z } from '@/shared/zod'

/**
 * Форматы отчётов «по ТЗ» и «Каталог по ТЗ» (решение 145, ТЗ требования к решению п.4
 * и функц. требования: результирующий json-файл и форматы отчётов).
 *
 * `pdf` из ТЗ здесь не эндпоинт: это печать листа браузером («Печать / PDF»,
 * см. `/reports/portfolio` — тот же принцип для «Отчёта руководителю»), а не файл,
 * который формирует сервер.
 */
export const REPORT_FORMATS = ['csv', 'xlsx', 'json'] as const
export type ReportFormat = (typeof REPORT_FORMATS)[number]

export const reportQuerySchema = z.object({
  format: z.enum(REPORT_FORMATS).default('csv'),
})

export type ReportQuery = z.infer<typeof reportQuerySchema>
