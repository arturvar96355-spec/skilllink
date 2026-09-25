import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody } from '@/shared/http'
import * as service from '@/modules/skills/skills.service'
import { mergeSkillSchema } from '@/modules/skills/skills.schema'

type Context = { params: Promise<{ id: string }> }

/** Объединить дубль в целевой навык одной транзакцией (только администратор, решение 107). */
export const POST = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const input = await parseBody(request, mergeSkillSchema)
  return ok(await service.merge(user, id, input))
})
