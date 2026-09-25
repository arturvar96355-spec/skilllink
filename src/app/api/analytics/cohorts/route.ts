import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/analytics/stage-analytics.service'

/** Когорты (решение 120): квартал старта × кварталы с начала → доля с подписанным договором. */
export const GET = handle(async () => {
  const user = await getCurrentUser()
  return ok(await service.cohorts(user))
})
