import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody } from '@/shared/http'
import * as service from '@/modules/cooperation/cooperation.service'
import { updateCooperationSchema } from '@/modules/cooperation/cooperation.schema'

type Context = { params: Promise<{ id: string }> }

export const GET = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  return ok(await service.getById(user, id))
})

export const PATCH = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const input = await parseBody(request, updateCooperationSchema)
  return ok(await service.update(user, id, input))
})
