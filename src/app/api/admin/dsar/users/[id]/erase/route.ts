import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody } from '@/shared/http'
import * as service from '@/modules/dsar/dsar.service'
import { eraseSubjectSchema } from '@/modules/dsar/dsar.schema'

type Context = { params: Promise<{ id: string }> }

/**
 * Обезличить пользователя по запросу субъекта (решение 116). Только ADMIN,
 * тело `{ confirm: "<логин>" }`. Необратимо; повтор — 200 с alreadyErased.
 */
export const POST = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const input = await parseBody(request, eraseSubjectSchema)
  return ok(await service.eraseUser(user, id, input))
})
