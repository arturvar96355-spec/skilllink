import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as adminService from '@/modules/telegram/telegram.admin.service'

/**
 * Админка бота Telegram (решение 142): статус для «Настройки → Интеграции».
 * Только ADMIN. Токен нигде в ответе не появляется.
 */
export const dynamic = 'force-dynamic'

export const GET = handle(async () => {
  const user = await getCurrentUser()
  return ok(await adminService.adminStatus(user))
})
