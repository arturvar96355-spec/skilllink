import { after } from 'next/server'
import { resolveSecret } from '@/shared/auth/auth'
import { CHANNEL_WEBHOOK } from '@/shared/config/notify-channels.config'
import { handle, ok, readBodyBytes, validationError } from '@/shared/http'
import { log } from '@/shared/log/logger'
import { maxAdapter } from '@/modules/notify-channels/channels/max.adapter'
import { maxUpdateSchema, type MaxUpdate } from '@/modules/notify-channels/notify-channels.schema'
import * as service from '@/modules/notify-channels/notify-channels.service'

/**
 * Вебхук бота MAX (решение 144). Вызывает MAX, не браузер: подлинность — заголовок
 * X-Max-Bot-Api-Secret. Без токена MAX_WEBHOOK_SECRET канал «для галочки»
 * (решение владельца): вебхук закрыт для всех — 403, отправка при этом не задета.
 *
 * Тот же приём, что вебхук Telegram (`/api/telegram/webhook`, решение 102, 133):
 * отвечает 200 сразу, обрабатывает после ответа (`after`); повтор того же события
 * (то же update_id уже отмечен в channel_updates_seen) — тихий 200 без повторной
 * отправки.
 */
export const dynamic = 'force-dynamic'

const SECRET_HEADER = 'x-max-bot-api-secret'

async function readUpdate(request: Request): Promise<MaxUpdate | null> {
  try {
    const bytes = await readBodyBytes(request, CHANNEL_WEBHOOK.maxBodyBytes, () =>
      validationError('Тело запроса слишком большое'),
    )
    const parsed = maxUpdateSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)))
    if (parsed.success) return parsed.data
    log.warn('[notify-channels] обновление MAX неизвестного вида пропущено')
  } catch {
    log.warn('[notify-channels] тело обновления MAX не прочитано')
  }
  return null
}

/**
 * Ключ дедупликации: MAX не документирует единый числовой update_id для вебхука
 * (в отличие от Telegram) — берём id сообщения (`mid`), а для событий без него
 * (например «бот запущен») — тип события и время.
 */
function updateKey(update: MaxUpdate): string {
  return update.message?.body?.mid ?? `${update.update_type}:${update.timestamp ?? Date.now()}`
}

export const POST = handle(async (request) => {
  service.assertMaxWebhookSecret(request.headers.get(SECRET_HEADER))
  const update = await readUpdate(request)
  if (update) {
    const id = updateKey(update)
    if (await service.acceptUpdate('max', id)) {
      const parsed = maxAdapter.parseInbound(update)
      if (parsed) {
        const secret = resolveSecret()
        after(() => service.handleInbound('max', parsed, secret))
      }
    }
  }
  return ok({ accepted: update !== null })
})
