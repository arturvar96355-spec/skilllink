import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/recommendations/recommendations.learning.service'

/** Вес каждого правила рекомендаций и его интервал — по решениям сотрудников (решение 119). */
export const GET = handle(async () => {
  const user = await getCurrentUser()
  return ok(await service.ruleStats(user))
})
