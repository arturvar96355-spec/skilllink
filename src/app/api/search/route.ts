import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseQuery } from '@/shared/http'
import * as service from '@/modules/search/search.service'
import { searchQuerySchema } from '@/modules/search/search.schema'

/**
 * Глобальный поиск — окно в стиле Spotlight: вузы, программы, связки, продукты,
 * навыки и документы одним запросом, сгруппированные по разделам.
 */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, searchQuerySchema)
  return ok(await service.search(user, query))
})
