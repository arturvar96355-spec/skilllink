import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody } from '@/shared/http'
import * as service from '@/modules/universities/universities.service'
import { setContactBasisSchema } from '@/modules/universities/universities.schema'

type Context = { params: Promise<{ id: string; contactId: string }> }

/**
 * Зафиксировать правовое основание обработки ПД контакта и согласие (решение 111).
 * ADMIN и MANAGER. Повтор той же формы ничего не меняет.
 */
export const PUT = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id, contactId } = await context.params
  const input = await parseBody(request, setContactBasisSchema)
  return ok(await service.setContactBasis(user, id, contactId, input))
})
