import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/ai-assist/ai-assist.service'

/**
 * «Что сделать сегодня» для текущего пользователя (решение 84): его открытые
 * рекомендации и проблемные этапы его связок. Порядок задают правила,
 * модель только формулирует.
 */
export const POST = handle(async () => {
  const user = await getCurrentUser()
  return ok(await service.todayPlan(user))
})
