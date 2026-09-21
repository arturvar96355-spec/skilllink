import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody } from '@/shared/http'
import * as service from '@/modules/programs/programs.service'
import { setProgramSkillsSchema } from '@/modules/programs/programs.schema'

type Context = { params: Promise<{ id: string }> }

/** Полная замена набора навыков программы. */
export const PUT = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const input = await parseBody(request, setProgramSkillsSchema)
  return ok(await service.setSkills(user, id, input))
})
