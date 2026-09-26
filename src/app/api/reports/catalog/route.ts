import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, parseQuery } from '@/shared/http'
import { reportQuerySchema } from '@/modules/reports/reports.schema'
import { buildCatalogReport } from '@/modules/reports/reports.service'
import { reportFileResponse } from '@/modules/reports/reports.http'

/**
 * «Каталог по ТЗ» (решение 145, п.8): «Название вуза, Вендор, ПО, Номер договора,
 * Подписание лицензии, Срок действия лицензии (год), Статус по передаче,
 * ФИО менеджера, Ответственные от вуза, Комментарий».
 */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const { format } = parseQuery(request, reportQuerySchema)
  const payload = await buildCatalogReport(user)
  return reportFileResponse('catalog-report', payload, format)
})
