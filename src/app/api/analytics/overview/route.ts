import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/analytics/analytics.service'

/** Сводка главной страницы. Каждый показатель несёт происхождение и признак демо-данных. */
export const GET = handle(async () => {
  const user = await getCurrentUser()
  return ok(await service.overview(user))
})
