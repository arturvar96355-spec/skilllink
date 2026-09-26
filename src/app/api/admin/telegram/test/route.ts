import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as adminService from '@/modules/telegram/telegram.admin.service'

/**
 * Проверочное сообщение (решение 142): в чат администратора, если он сам
 * подключил бота, иначе в чат владельца (TELEGRAM_OWNER_CHAT_ID). Только ADMIN.
 */
export const dynamic = 'force-dynamic'

export const POST = handle(async () => {
  const user = await getCurrentUser()
  return ok(await adminService.adminSendTest(user))
})
