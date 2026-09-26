import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, parseQuery } from '@/shared/http'
import { reportQuerySchema } from '@/modules/reports/reports.schema'
import { buildTzReport } from '@/modules/reports/reports.service'
import { reportFileResponse } from '@/modules/reports/reports.http'

/**
 * Отчёт «по ТЗ» (решение 145, п.7): «Наименование вуза, ИТ-направление, ИТ-продукт,
 * Статус работы с вузом, Ответственный» — колонки дословно и в этом порядке.
 */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const { format } = parseQuery(request, reportQuerySchema)
  const payload = await buildTzReport(user)
  return reportFileResponse('tz-report', payload, format)
})
