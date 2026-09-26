import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/audit/chain.service'

/**
 * Проверка целостности журнала действий: цепочка хешей и печати (решение 115).
 * Только для администратора. Факт проверки пишется в журнал.
 */
export const GET = handle(async () => {
  const user = await getCurrentUser()
  return ok(await service.verifyChainForAdmin(user))
})
