import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, okList, parseQuery } from '@/shared/http'
import * as service from '@/modules/auth/auth.service'
import { userListQuerySchema } from '@/modules/auth/auth.schema'

/** Справочник пользователей: выбор ответственного и участников встреч. */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, userListQuerySchema)
  const { data, meta } = await service.listUsers(user, query)
  return okList(data, meta)
})
