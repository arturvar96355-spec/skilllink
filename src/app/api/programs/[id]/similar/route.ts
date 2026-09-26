import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseQuery } from '@/shared/http'
import * as service from '@/modules/programs/similar.service'

type Context = { params: Promise<{ id: string }> }

/** Похожие программы по навыкам и чего не хватает этой (решение 134). */
export const GET = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const query = parseQuery(request, service.similarProgramsQuerySchema)
  return ok(await service.similarPrograms(user, id, query))
})
