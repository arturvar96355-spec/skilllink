import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/recommendations/recommendations.service'

/**
 * Пересобирает рекомендации по правилам.
 * Отклонённые с основанием не переписываются; открытые, чья проблема ушла,
 * закрываются; закрытые, чья проблема вернулась, открываются снова.
 */
export const POST = handle(async () => {
  const user = await getCurrentUser()
  return ok(await service.generate(user))
})
