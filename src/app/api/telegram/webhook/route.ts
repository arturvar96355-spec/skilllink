import { after } from 'next/server'
import { resolveSecret } from '@/shared/auth/auth'
import { TELEGRAM_WEBHOOK } from '@/shared/config/telegram.config'
import { handle, ok, readBodyBytes, validationError } from '@/shared/http'
import * as service from '@/modules/telegram/telegram.service'
import { telegramUpdateSchema, type TelegramUpdate } from '@/modules/telegram/telegram.schema'

/**
 * Вебхук бота личных уведомлений (решение 102). Вызывает Telegram, не браузер:
 * входа нет, подлинность — заголовок X-Telegram-Bot-Api-Secret-Token.
 *
 * Отвечает 200 сразу, а команду выполняет после ответа (`after`): Telegram ждёт
 * ответа недолго и, не дождавшись, повторяет обновление. По той же причине 200
 * и на то, что разобрать не удалось, — повтор того же обновления ничего не исправит;
 * причина уходит в журнал. 403 — только без верного секрета.
 *
 * Проверка «same-origin» в `handle()` запрос пропускает: у Telegram нет заголовка
 * Origin, а без него проверять нечего (shared/http/origin.ts).
 */
export const dynamic = 'force-dynamic'

const SECRET_HEADER = 'x-telegram-bot-api-secret-token'

async function readUpdate(request: Request): Promise<TelegramUpdate | null> {
  try {
    const bytes = await readBodyBytes(request, TELEGRAM_WEBHOOK.maxBodyBytes, () =>
      validationError('Тело запроса слишком большое'),
    )
    const parsed = telegramUpdateSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)))
    if (parsed.success) return parsed.data
    console.warn('[telegram] обновление неизвестного вида пропущено')
  } catch {
    console.warn('[telegram] тело обновления не прочитано')
  }
  return null
}

export const POST = handle(async (request) => {
  service.assertWebhookSecret(request.headers.get(SECRET_HEADER))
  const update = await readUpdate(request)
  if (update) {
    const secret = resolveSecret()
    after(() => service.handleUpdate(update, { secret }))
  }
  return ok({ accepted: update !== null })
})
