import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/analytics/stage-analytics.service'

/** «Система заметила» (решение 120): отклонения рядов и выводы по этапам — тексты по шаблонам. */
export const GET = handle(async () => {
  const user = await getCurrentUser()
  return ok(await service.insights(user))
})
