import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/universities/merge.service'

type Context = { params: Promise<{ id: string }> }

/** Отменить слияние вузов в пределах срока (только администратор, решение 134). */
export const POST = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  return ok(await service.undo(user, id))
})
