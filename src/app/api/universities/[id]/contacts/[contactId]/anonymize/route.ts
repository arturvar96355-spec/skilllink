import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/universities/universities.service'

type Context = { params: Promise<{ id: string; contactId: string }> }

/**
 * Обезличить контактное лицо вуза (право на удаление ПД, docs/PRIVACY.md).
 * Только ADMIN. Необратимо; повторный вызов возвращает тот же результат.
 */
export const POST = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id, contactId } = await context.params
  return ok(await service.anonymizeContact(user, id, contactId))
})
