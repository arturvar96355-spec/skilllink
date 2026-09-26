import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseQuery } from '@/shared/http'
import * as service from '@/modules/analytics/meetings-heatmap.service'

/** Тепловая карта проведённых встреч: день недели × час по Москве (решение 134). */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, service.meetingsHeatmapQuerySchema)
  return ok(await service.meetingsHeatmap(user, query))
})
