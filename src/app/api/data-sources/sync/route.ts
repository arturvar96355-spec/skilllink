import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseOptionalBody } from '@/shared/http'
import * as service from '@/modules/data-sources/data-sources.service'
import { syncMarketDataSchema } from '@/modules/data-sources/data-sources.schema'

/**
 * Загрузка рыночных данных из активного источника (MARKET_DATA_PROVIDER).
 * Сбой источника отдаёт INTEGRATION_ERROR 502 и не затрагивает остальную систему.
 */
export const POST = handle(async (request) => {
  const user = await getCurrentUser()
  const input = await parseOptionalBody(request, syncMarketDataSchema)
  return ok(await service.syncMarketData(user, input))
})
