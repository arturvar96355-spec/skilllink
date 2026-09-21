import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, okList, parseQuery } from '@/shared/http'
import { z } from '@/shared/zod'
import * as service from '@/modules/analytics/analytics.service'

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
})

/** Рейтинг программ по трём показателям с раскрытием вклада каждого. */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const { limit } = parseQuery(request, querySchema)
  const { data, total } = await service.programRating(user, { limit })
  // Сводка с ограничением, а не страница: `total` — сколько программ с рейтингом
  // всего, `truncated` — видно ли, что выборка обрезана.
  return okList(data, { page: 1, pageSize: data.length, total, truncated: total > data.length })
})
