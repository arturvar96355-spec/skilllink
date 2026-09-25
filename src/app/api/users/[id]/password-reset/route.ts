import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/auth/auth.service'

type Context = { params: Promise<{ id: string }> }

/**
 * Выдать новый временный пароль (только администратор). Пароль — в ответе,
 * один раз (кэш запрещён в next.config.ts); старый перестаёт подходить сразу.
 */
export const POST = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  return ok(await service.resetPassword(user, id))
})
