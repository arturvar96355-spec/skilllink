import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody } from '@/shared/http'
import * as service from '@/modules/auth/auth.service'
import { updateUserSchema } from '@/modules/auth/auth.schema'

type Context = { params: Promise<{ id: string }> }

/** Карточка пользователя для администратора: с открытыми связками и этапами. */
export const GET = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  return ok(await service.getManagedUser(user, id))
})

/** ФИО, должность, роль с вузом, блокировка и разблокировка (только администратор). */
export const PATCH = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const input = await parseBody(request, updateUserSchema)
  return ok(await service.updateUser(user, id, input))
})
