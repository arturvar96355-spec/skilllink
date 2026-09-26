import { getCurrentUser } from '@/shared/auth/current-user'
import { withIdempotency } from '@/shared/idempotency/idempotency'
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

/**
 * Создание связки сразу порождает все 14 этапов с чек-листами.
 * С заголовком Idempotency-Key повтор не создаёт вторую связку (решение 123).
 */
export const POST = handle(async (request) => {
  const user = await getCurrentUser()
  return withIdempotency(request, user.id, async (body) => {
    const input = await parseBody(body, createCooperationSchema)
    return created(await service.create(user, input))
  })
})
