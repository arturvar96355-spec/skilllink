import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, okList, parseQuery } from '@/shared/http'
import * as service from '@/modules/data-sources/data-sources.service'
import { dataSourceListQuerySchema } from '@/modules/data-sources/data-sources.schema'

/** Источники данных с происхождением: что откуда пришло и насколько надёжно. */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, dataSourceListQuerySchema)
  const { data, meta } = await service.list(user, query)
  return okList(data, meta)
})
