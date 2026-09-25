import { getCurrentUser } from '@/shared/auth/current-user'
import { created, handle, okList, parseBody, parseQuery } from '@/shared/http'
import * as service from '@/modules/dsar/dsar.service'
import { createDsarRequestSchema, dsarRequestListQuerySchema } from '@/modules/dsar/dsar.schema'

/** Реестр запросов субъектов ПД (решение 116), новые сверху. Только ADMIN. */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const result = await service.listRequests(user, parseQuery(request, dsarRequestListQuerySchema))
  return okList(result.data, result.meta)
})

/** Зарегистрировать запрос, пришедший письмом: срок ответа — от даты получения. */
export const POST = handle(async (request) => {
  const user = await getCurrentUser()
  const input = await parseBody(request, createDsarRequestSchema)
  return created(await service.registerRequest(user, input))
})
