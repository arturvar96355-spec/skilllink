import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/notify-channels/notify-channels.service'

/** Статус каналов уведомлений для администратора (решение 144): что настроено, сколько привязано. */
export const GET = handle(async () => {
  const user = await getCurrentUser()
  return ok(await service.adminStatus(user))
})
