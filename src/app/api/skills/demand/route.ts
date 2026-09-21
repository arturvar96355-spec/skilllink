import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, okList, parseQuery } from '@/shared/http'
import * as service from '@/modules/skills/skills.service'
import { skillDemandQuerySchema } from '@/modules/skills/skills.schema'

/** Востребованность навыков на рынке. Каждая строка несёт источник и признак демо-данных. */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, skillDemandQuerySchema)
  const result = await service.demand(user, query)
  // Это не постраничный список, а сводка с ограничением по размеру.
  // `total` — сколько найдено всего, `pageSize` — сколько отдано: по ним видно,
  // что выборка обрезана, и интерфейс может сказать «показаны 50 из 180».
  return okList(result.data, {
    page: 1,
    pageSize: result.data.length,
    total: result.total,
    truncated: result.total > result.data.length,
    period: result.period,
    isMock: result.isMock,
  })
})
