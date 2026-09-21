import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/recommendations/recommendations.service'

/**
 * Пересобирает рекомендации по правилам.
 * Решения сотрудника (принято, отклонено) при пересборке не переписываются.
 */
export const POST = handle(async () => {
  const user = await getCurrentUser()
  return ok(await service.generate(user))
})
