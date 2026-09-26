import { getCurrentUser } from '@/shared/auth/current-user'
import { created, handle, okList, parseBody, parseQuery } from '@/shared/http'
import * as service from '@/modules/approvals/approvals.service'
import { approvalListQuerySchema, createApprovalSchema } from '@/modules/approvals/approvals.schema'

/** Запросы на одобрение опасных операций (решение 123). Только администратор. */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, approvalListQuerySchema)
  const { data, meta } = await service.list(user, query)
  return okList(data, meta)
})

/** Запросить одобрение: действие и параметры (только идентификаторы). */
export const POST = handle(async (request) => {
  const user = await getCurrentUser()
  const input = await parseBody(request, createApprovalSchema)
  return created(await service.request(user, input))
})
