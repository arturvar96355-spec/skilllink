import { getCurrentUser } from '@/shared/auth/current-user'
import { created, handle, okList, parseBody, parseQuery } from '@/shared/http'
import * as service from '@/modules/programs/programs.service'
import { createProgramSchema, programListQuerySchema } from '@/modules/programs/programs.schema'

export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, programListQuerySchema)
  const { data, meta } = await service.list(user, query)
  return okList(data, meta)
})

export const POST = handle(async (request) => {
  const user = await getCurrentUser()
  const input = await parseBody(request, createProgramSchema)
  return created(await service.create(user, input))
})
