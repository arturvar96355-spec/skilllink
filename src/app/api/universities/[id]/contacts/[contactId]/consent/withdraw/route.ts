import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody } from '@/shared/http'
import * as service from '@/modules/universities/universities.service'
import { withdrawConsentSchema } from '@/modules/universities/universities.schema'

type Context = { params: Promise<{ id: string; contactId: string }> }

/**
 * Отозвать согласие контакта (ч. 5 ст. 21 152-ФЗ, решение 111). ADMIN и MANAGER.
 * Согласие — единственное основание, поэтому контакт сразу обезличивается.
 * Необратимо; повторный вызов возвращает тот же результат.
 */
export const POST = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id, contactId } = await context.params
  const input = await parseBody(request, withdrawConsentSchema)
  return ok(await service.withdrawContactConsent(user, id, contactId, input))
})
