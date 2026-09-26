import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, parseQuery } from '@/shared/http'
import { reportQuerySchema } from '@/modules/reports/reports.schema'
import { buildCatalogReport } from '@/modules/reports/reports.service'
import { reportFileResponse } from '@/modules/reports/reports.http'

/**
 * «Каталог по ТЗ» (решение 145, п.8): «Название вуза, Вендор, ПО, Номер договора,
 * Подписание лицензии, Срок действия лицензии (год), Статус по передаче,
 * ФИО менеджера, Ответственные от вуза, Комментарий».
 *
 * Фильтры (решение 172) — те же, что у отчёта «по ТЗ»: `dateFrom`, `dateTo`,
 * `universityId`, `programId`, `productId`, `responsibleId`, `status`.
 */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const { format, ...filters } = parseQuery(request, reportQuerySchema)
  const { payload, labels } = await buildCatalogReport(user, filters)
  return reportFileResponse('catalog-report', payload, format, filters, labels)
})
