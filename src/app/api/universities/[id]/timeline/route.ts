import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, okList, parseQuery } from '@/shared/http'
import * as service from '@/modules/universities/timeline.service'
import { timelineQuerySchema } from '@/modules/universities/timeline.schema'

type Context = { params: Promise<{ id: string }> }

/** Лента 360 вуза: все события одной лентой, курсорная пагинация (решение 134). */
export const GET = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const query = parseQuery(request, timelineQuerySchema)
  const { data, meta } = await service.universityTimeline(user, id, query)
  // Лента, а не страница: вместо total — курсор и признак «есть ещё».
  return okList(data, { page: 1, pageSize: data.length, total: data.length, ...meta })
})
