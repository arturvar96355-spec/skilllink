import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseOptionalBody } from '@/shared/http'
import * as service from '@/modules/approvals/approvals.service'
import { rejectApprovalSchema } from '@/modules/approvals/approvals.schema'

type Context = { params: Promise<{ id: string }> }

/**
 * Отклонить запрос (решение 133): любой администратор, в том числе автор — отозвать свой.
 * Тело необязательно: `{ reason }` — почему отклонено, увидит запросивший (решение 218).
 */
export const POST = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const input = await parseOptionalBody(request, rejectApprovalSchema)
  return ok(await service.reject(user, id, input))
})
