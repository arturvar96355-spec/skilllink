import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseQuery } from '@/shared/http'
import * as service from '@/modules/notifications/notifications.service'
import { notificationFeedQuerySchema } from '@/modules/notifications/notifications.schema'

/**
 * Лента уведомлений под колокольчиком в шапке: просроченные и подходящие сроки,
 * изменения по своим связкам и документам, важные рекомендации. Каждое
 * уведомление ведёт к своему объекту.
 */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, notificationFeedQuerySchema)
  return ok(await service.feed(user, query))
})
