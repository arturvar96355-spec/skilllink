import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, okList, parseQuery } from '@/shared/http'
import * as service from '@/modules/universities/universities.service'
import { contactBasisHistoryQuerySchema } from '@/modules/universities/universities.schema'

type Context = { params: Promise<{ id: string; contactId: string }> }

/** История основания обработки ПД и согласия контакта (решение 111). ADMIN и MANAGER. */
export const GET = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id, contactId } = await context.params
  const query = parseQuery(request, contactBasisHistoryQuerySchema)
  const { data, meta } = await service.contactBasisHistory(user, id, contactId, query)
  return okList(data, meta)
})
