import { getCurrentUser } from '@/shared/auth/current-user'
import { created, handle, okList, parseBody, parseQuery } from '@/shared/http'
import * as service from '@/modules/universities/universities.service'
import {
  createUniversitySchema,
  universityListQuerySchema,
} from '@/modules/universities/universities.schema'

export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, universityListQuerySchema)
  const { data, meta } = await service.list(user, query)
  return okList(data, meta)
})

export const POST = handle(async (request) => {
  const user = await getCurrentUser()
  const input = await parseBody(request, createUniversitySchema)
  return created(await service.create(user, input))
})
