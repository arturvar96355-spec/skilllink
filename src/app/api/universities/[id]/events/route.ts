import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, okList, parseQuery } from '@/shared/http'
import * as service from '@/modules/audit/audit.service'
import { universityEventsQuerySchema } from '@/modules/audit/audit.schema'

type Context = { params: Promise<{ id: string }> }

/** Лента последних событий вуза (раздел 7.3 ТЗ) — вкладка «История». */
export const GET = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const query = parseQuery(request, universityEventsQuerySchema)
  const { events, hasMore } = await service.universityEvents(user, id, query)

  // Лента, а не страница: `limit` вместо page/pageSize, и вместо total —
  // признак, что показано не всё.
  return okList(events, { page: 1, pageSize: events.length, total: events.length, hasMore })
})
