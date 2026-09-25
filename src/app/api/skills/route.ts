import { getCurrentUser } from '@/shared/auth/current-user'
import { created, handle, okList, parseBody, parseQuery } from '@/shared/http'
import * as service from '@/modules/skills/skills.service'
import { createSkillSchema, skillListQuerySchema } from '@/modules/skills/skills.schema'

export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, skillListQuerySchema)
  const { data, meta } = await service.list(user, query)
  return okList(data, meta)
})

/** Добавить навык в справочник (только администратор, решение 107). */
export const POST = handle(async (request) => {
  const user = await getCurrentUser()
  const input = await parseBody(request, createSkillSchema)
  return created(await service.create(user, input))
})
