import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/programs/programs.service'

type Context = { params: Promise<{ id: string }> }

/** Возврат программы из архива. Парная операция к архивированию. */
export const POST = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  return ok(await service.restore(user, id))
})
