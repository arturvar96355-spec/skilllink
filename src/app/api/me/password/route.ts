import { getCurrentUser } from '@/shared/auth/current-user'
import { clientAddress } from '@/shared/auth/throttle'
import { handle, ok, parseBody } from '@/shared/http'
import * as service from '@/modules/auth/auth.service'
import { changePasswordSchema } from '@/modules/auth/auth.schema'

/**
 * Смена своего пароля — любая роль, включая представителя вуза.
 * Только для себя: пользователь берётся из сессии, идентификатора в запросе нет.
 */
export const POST = handle(async (request) => {
  const user = await getCurrentUser()
  const input = await parseBody(request, changePasswordSchema)
  return ok(await service.changeOwnPassword(user, input, clientAddress(request.headers)))
})
