import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseOptionalBody } from '@/shared/http'
import * as service from '@/modules/notifications/notifications.service'
import { markNotificationsSeenSchema } from '@/modules/notifications/notifications.schema'

/**
 * Отметка «просмотрено» для ленты уведомлений (решение 139).
 *
 * Раньше это жило только в localStorage браузера — на другом устройстве или после
 * очистки хранилища вся лента снова выглядела новой. Теперь отметка хранится
 * на сервере (`users.notifications_seen_at`) и `GET /api/notifications` берёт её
 * оттуда сама, без параметра `since`.
 *
 * Без тела — ставится текущее время сервера. С `seenAt` — переданное время, если
 * оно не в будущем.
 */
export const POST = handle(async (request) => {
  const user = await getCurrentUser()
  const input = await parseOptionalBody(request, markNotificationsSeenSchema)
  return ok(await service.markSeen(user, input))
})
