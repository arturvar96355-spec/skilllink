import { getCurrentUser } from '@/shared/auth/current-user'
import { withIdempotency } from '@/shared/idempotency/idempotency'
import { created, handle, okList, parseBody, parseQuery } from '@/shared/http'
import * as service from '@/modules/assignments/assignments.service'
import { assignmentListQuerySchema, createAssignmentSchema } from '@/modules/assignments/assignments.schema'

/** Поручения сотрудникам (решение 207): список и создание. Права — в сервисе. */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, assignmentListQuerySchema)
  const { data, meta } = await service.list(user, query)
  return okList(data, meta)
})

export const POST = handle(async (request) => {
  const user = await getCurrentUser()
  return withIdempotency(request, user.id, async (body) => {
    const input = await parseBody(body, createAssignmentSchema)
    return created(await service.create(user, input))
  })
})
