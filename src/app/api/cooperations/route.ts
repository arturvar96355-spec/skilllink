import { getCurrentUser } from '@/shared/auth/current-user'
import { created, handle, okList, parseBody, parseQuery } from '@/shared/http'
import * as service from '@/modules/cooperation/cooperation.service'
import {
  cooperationListQuerySchema,
  createCooperationSchema,
} from '@/modules/cooperation/cooperation.schema'

export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, cooperationListQuerySchema)
  const { data, meta } = await service.list(user, query)
  return okList(data, meta)
})

/** Создание связки сразу порождает все 14 этапов с чек-листами. */
export const POST = handle(async (request) => {
  const user = await getCurrentUser()
  const input = await parseBody(request, createCooperationSchema)
  return created(await service.create(user, input))
})
