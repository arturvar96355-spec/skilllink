import { getCurrentUser } from '@/shared/auth/current-user'
import { created, handle, okList, parseBody, parseQuery } from '@/shared/http'
import * as service from '@/modules/auth/auth.service'
import { createUserSchema, userListQuerySchema } from '@/modules/auth/auth.schema'

/** Справочник пользователей: выбор ответственного и участников встреч. */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, userListQuerySchema)
  const { data, meta } = await service.listUsers(user, query)
  return okList(data, meta)
})

/**
 * Завести пользователя (только администратор). В ответе — временный пароль,
 * единственный раз; кэш ответов /api/users/* запрещён в next.config.ts (`no-store`).
 */
export const POST = handle(async (request) => {
  const user = await getCurrentUser()
  const input = await parseBody(request, createUserSchema)
  return created(await service.createUser(user, input))
})
