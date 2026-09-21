import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, okList, parseQuery } from '@/shared/http'
import * as service from '@/modules/skills/skills.service'
import { skillListQuerySchema } from '@/modules/skills/skills.schema'

export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, skillListQuerySchema)
  const { data, meta } = await service.list(user, query)
  return okList(data, meta)
})
