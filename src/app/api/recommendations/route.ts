import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, okList, parseQuery } from '@/shared/http'
import * as service from '@/modules/recommendations/recommendations.service'
import { recommendationListQuerySchema } from '@/modules/recommendations/recommendations.schema'

export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, recommendationListQuerySchema)
  const { data, meta } = await service.list(user, query)
  return okList(data, meta)
})
