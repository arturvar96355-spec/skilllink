import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody } from '@/shared/http'
import * as service from '@/modules/skills/skills.service'
import { updateSkillSchema } from '@/modules/skills/skills.schema'

type Context = { params: Promise<{ id: string }> }

/** Переименовать навык, сменить категорию или описание (только администратор). */
export const PATCH = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const input = await parseBody(request, updateSkillSchema)
  return ok(await service.update(user, id, input))
})

/** Удалить навык, который нигде не используется; используемый — 409 (только администратор). */
export const DELETE = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  return ok(await service.remove(user, id))
})
