import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/approvals/approvals.service'

type Context = { params: Promise<{ id: string }> }

/**
 * Отклонить запрос (решение 123): любой администратор, в том числе автор — отозвать свой.
 * Тело не нужно.
 */
export const POST = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  return ok(await service.reject(user, id))
})
