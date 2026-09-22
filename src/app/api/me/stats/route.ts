import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import { personalStats } from '@/modules/analytics/analytics.service'

/**
 * Личная статистика — блок «Статистика» личного кабинета: активные связки,
 * вузы в работе, программы под управлением, этапы в срок и просроченные.
 * Всё по связкам и этапам, где текущий пользователь — ответственный.
 */
export const GET = handle(async () => {
  const user = await getCurrentUser()
  return ok(await personalStats(user))
})
