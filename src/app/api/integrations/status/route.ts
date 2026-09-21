import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/data-sources/data-sources.service'

/**
 * Состояние интеграций: что настроено, что выключено и почему.
 * Наличие конкретных внутренних API заказчика не утверждается.
 */
export const GET = handle(async () => {
  const user = await getCurrentUser()
  return ok(service.status(user))
})
