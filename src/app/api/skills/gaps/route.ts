import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, okList, parseQuery } from '@/shared/http'
import * as service from '@/modules/skills/skills.service'
import { skillGapQuerySchema } from '@/modules/skills/skills.schema'

/** Дефицит навыков: спрос рынка против содержания программ. */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, skillGapQuerySchema)
  const result = await service.gaps(user, query)
  return okList(result.data, {
    page: 1,
    pageSize: result.data.length,
    total: result.data.length,
    period: result.period,
    programId: result.programId,
    isMock: result.isMock,
  })
})
