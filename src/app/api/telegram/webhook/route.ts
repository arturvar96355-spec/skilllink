import { after } from 'next/server'
import { resolveSecret } from '@/shared/auth/auth'
import { TELEGRAM_WEBHOOK } from '@/shared/config/telegram.config'
import { handle, ok, readBodyBytes, validationError } from '@/shared/http'
import { log } from '@/shared/log/logger'
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
 * Повтор (тот же update_id уже отмечен в базе, решение 133) — тихий 200 без
 * выполнения: Telegram не должен его повторять. Секрет сверяется с хешем из базы,
 * если администратор его сменял, иначе — с TELEGRAM_WEBHOOK_SECRET.
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
    log.warn('[telegram] обновление неизвестного вида пропущено')
  } catch {
    log.warn('[telegram] тело обновления не прочитано')
  }
  return null
}

export const POST = handle(async (request) => {
  await service.assertWebhookSecret(request.headers.get(SECRET_HEADER))
  const update = await readUpdate(request)
  // Повтор не выполняется второй раз, но ответ тот же: Telegram не отличит и не повторит.
  if (update && (await service.acceptUpdate(update.update_id))) {
    const secret = resolveSecret()
    after(() => service.handleUpdate(update, { secret }))
  }
  return ok({ accepted: update !== null })
})
