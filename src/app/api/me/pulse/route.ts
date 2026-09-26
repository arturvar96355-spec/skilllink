import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import { pulseFor } from '@/modules/analytics/pulse.service'

/**
 * Пульс (решение 120): «Внимание», «Сегодня», «Решить», «Успехи» по связкам
 * текущего пользователя — то же содержимое, что сводка в Telegram.
 */
export const GET = handle(async () => {
  const user = await getCurrentUser()
  return ok(await pulseFor(user))
})
