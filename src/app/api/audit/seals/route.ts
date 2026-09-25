import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, okList, parseQuery } from '@/shared/http'
import { paginationSchema } from '@/shared/http/pagination'
import * as service from '@/modules/audit/chain.service'

/** Печати журнала действий, новые сверху (решение 115). Только для администратора. */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, paginationSchema)
  const { data, meta } = await service.listSealsForAdmin(user, query)
  return okList(data, meta)
})
