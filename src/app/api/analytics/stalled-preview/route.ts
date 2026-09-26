import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseQuery } from '@/shared/http'
import * as service from '@/modules/analytics/stage-analytics.service'
import { stalledPreviewQuerySchema } from '@/modules/analytics/stage-analytics.schema'

/**
 * Предпросмотр порога застоя (решение 120): сколько открытых связок станут
 * или перестанут быть «застрявшими» при пороге `days` — до того, как менять параметр.
 */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, stalledPreviewQuerySchema)
  return ok(await service.stalledPreview(user, query))
})
