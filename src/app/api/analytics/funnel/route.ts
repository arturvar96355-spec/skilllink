import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseQuery } from '@/shared/http'
import * as service from '@/modules/analytics/stage-analytics.service'
import { funnelQuerySchema } from '@/modules/analytics/stage-analytics.schema'

/** Воронка по этапам или вехам (решение 120): дошли, конверсии, время перехода, отвалившиеся. */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, funnelQuerySchema)
  return ok(await service.funnel(user, query))
})
