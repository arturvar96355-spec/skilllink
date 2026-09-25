import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/analytics/stage-analytics.service'

/**
 * Длительность этапов по Каплану–Мейеру (решение 120): по каждому этапу 1–13 —
 * наблюдения, переходы, цензура, медиана, p90 с интервалом, кривая и порог застоя.
 */
export const GET = handle(async () => {
  const user = await getCurrentUser()
  return ok(await service.stageDurations(user))
})
