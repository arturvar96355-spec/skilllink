import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/analytics/forecast.service'

/**
 * Переобучает модель прогноза по обеим вехам (решение 132). Только администратор.
 * Тяжёлый маршрут (группа `heavy`, rate-limit.config.ts) — читает всю историю
 * связок. Тело не нужно.
 */
export const POST = handle(async () => {
  const user = await getCurrentUser()
  return ok(await service.trainModels(user))
})
