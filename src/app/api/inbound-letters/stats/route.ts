import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/inbound-letters/inbound-letters.service'

/** Точность разбора по группе (решение 170) — «верно N из M последних» и текущая доля с забыванием. */
export const GET = handle(async () => {
  const user = await getCurrentUser()
  return ok(await service.stats(user))
})
