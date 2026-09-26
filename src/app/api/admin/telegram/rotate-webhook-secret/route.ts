import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/telegram/telegram.service'

/**
 * Смена секрета вебхука Telegram (решение 123). Только администратор.
 * Сначала setWebhook у Telegram с новым секретом, при успехе — хеш в базу;
 * отказ Telegram — 502, прежний секрет продолжает действовать. Секрета нет
 * ни в ответе, ни в журнале. Тело не нужно.
 */
export const dynamic = 'force-dynamic'

export const POST = handle(async () => {
  const user = await getCurrentUser()
  return ok(await service.rotateWebhookSecret(user))
})
