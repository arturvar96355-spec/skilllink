import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/inbound-letters/inbound-letters.service'

type Context = { params: Promise<{ id: string }> }

/** «Задание выполнено» по письму вуза (решение 183). Тело не нужно. */
export const POST = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  return ok(await service.completeTask(user, id))
})
