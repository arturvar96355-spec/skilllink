import { resolveSecret } from '@/shared/auth/auth'
import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody } from '@/shared/http'
import * as adminService from '@/modules/telegram/telegram.admin.service'
import { telegramSetTokenSchema } from '@/modules/telegram/telegram.schema'

/**
 * Токен бота (решение 142). Только ADMIN. Токен проверяется у Telegram (`getMe`)
 * до сохранения; хранится зашифрованным в базе (главнее env). Ни в ответе, ни
 * в журнале самого токена нет.
 */
export const dynamic = 'force-dynamic'

/** Проверка → сохранение → новый секрет вебхука (или перезапуск polling). */
export const PUT = handle(async (request) => {
  const user = await getCurrentUser()
  const body = await parseBody(request, telegramSetTokenSchema)
  return ok(await adminService.adminSetToken(user, body, resolveSecret()))
})

/** Отключить бота: удалить токен из базы. Токен в env (если есть) продолжит действовать. */
export const DELETE = handle(async () => {
  const user = await getCurrentUser()
  return ok(await adminService.adminClearToken(user, resolveSecret()))
})
