import { after } from 'next/server'
import { resolveSecret } from '@/shared/auth/auth'
import { CHANNEL_WEBHOOK } from '@/shared/config/notify-channels.config'
import { handle, readBodyBytes, validationError } from '@/shared/http'
import { forbidden } from '@/shared/http/errors'
import { log } from '@/shared/log/logger'
import { vkAdapter } from '@/modules/notify-channels/channels/vk.adapter'
import { vkCallbackEventSchema, type VkCallbackEvent } from '@/modules/notify-channels/notify-channels.schema'
import * as service from '@/modules/notify-channels/notify-channels.service'

/**
 * Callback API сообщества VK (решение 144). Устроен не так, как вебхуки Telegram/MAX:
 * подлинность — не заголовок, а поле `secret` в теле каждого события; событие
 * `confirmation` требует ответа открытым текстом с кодом из VK_CONFIRMATION_CODE
 * (VK показывает его при включении Callback API — им отвечаем, не JSON). Любой
 * другой ответ, кроме "ok", VK трактует как сбой и повторяет доставку.
 *
 * Без VK_CONFIRMATION_CODE/VK_SECRET канал «для галочки» (решение владельца):
 * подтвердить адрес нечем, входящие не проходят проверку секрета — 403;
 * отправка сообщений при этом не задета.
 */
export const dynamic = 'force-dynamic'

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

async function readEvent(request: Request): Promise<VkCallbackEvent | null> {
  try {
    const bytes = await readBodyBytes(request, CHANNEL_WEBHOOK.maxBodyBytes, () =>
      validationError('Тело запроса слишком большое'),
    )
    const parsed = vkCallbackEventSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)))
    if (parsed.success) return parsed.data
    log.warn('[notify-channels] событие VK неизвестного вида пропущено')
  } catch {
    log.warn('[notify-channels] тело события VK не прочитано')
  }
  return null
}

export const POST = handle(async (request) => {
  const event = await readEvent(request)
  // Нераспознанное тело — тоже "ok": VK не должен повторять то, что и так не разобрать.
  if (!event) return textResponse('ok')

  if (event.type === 'confirmation') {
    const code = service.vkConfirmationCode()
    if (!code) throw forbidden('Callback API VK не настроен администратором')
    return textResponse(code)
  }

  if (!service.vkSecretMatches(event.secret)) throw forbidden('Запрос не от VK')

  const id = event.event_id ?? `no-id:${Date.now()}`
  if (await service.acceptUpdate('vk', id)) {
    const parsed = vkAdapter.parseInbound(event)
    if (parsed) {
      const secret = resolveSecret()
      after(() => service.handleInbound('vk', parsed, secret))
    }
  }
  return textResponse('ok')
})
