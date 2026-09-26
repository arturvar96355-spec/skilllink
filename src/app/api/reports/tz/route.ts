import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, parseQuery } from '@/shared/http'
import { reportQuerySchema } from '@/modules/reports/reports.schema'
import { buildTzReport } from '@/modules/reports/reports.service'
import { reportFileResponse } from '@/modules/reports/reports.http'

/**
 * Отчёт «по ТЗ» (решение 145, п.7): «Наименование вуза, ИТ-направление, ИТ-продукт,
 * Статус работы с вузом, Ответственный» — колонки дословно и в этом порядке.
 *
 * Фильтры (решение 172, ТЗ заказчика — «отчёты формируются с фильтрами по периоду,
 * вузу, ИТ-направлению, ИТ-продукту и ответственному»): `dateFrom`, `dateTo`,
 * `universityId`, `programId`, `productId`, `responsibleId`, `status` — все
 * необязательны, работают вместе с `format`.
 */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const { format, ...filters } = parseQuery(request, reportQuerySchema)
  const { payload, labels } = await buildTzReport(user, filters)
  return reportFileResponse('tz-report', payload, format, filters, labels)
})
