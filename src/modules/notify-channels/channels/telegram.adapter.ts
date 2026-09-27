import { getTelegramClient } from '@/integrations/telegram'
import { actionSigningSecret, toInlineKeyboard } from '@/modules/telegram/telegram.actions'
import { toChannelMessage, type ChannelAdapter, type ChannelSendResult, type ParsedInbound } from '../notify-channels.types'

/**
 * Адаптер Telegram (решение 144) — тонкая обёртка над `@/integrations/telegram`
 * (клиент Bot API, публичный экспорт `getTelegramClient`). Из `src/modules/telegram`
 * берёт только чистые функции кнопок (`telegram.actions.ts`, решение 200): подпись
 * «Принял» у Telegram своя, её формат не общий для каналов.
 *
 * Привязка Telegram и разбор его вебхука остаются в `src/modules/telegram` как есть:
 * `linkUrl`/`parseInbound` здесь не используются в проде — Telegram ходит через свой
 * собственный `/api/telegram/webhook` и `telegram.service.connect`. Они возвращают
 * `null`, чтобы это было явной ошибкой применения, а не тихой заглушкой.
 */
export const telegramAdapter: ChannelAdapter = {
  id: 'telegram',

  configured(): boolean {
    return getTelegramClient().enabled
  },

  /**
   * Кнопки (решение 200): «Открыть» — ссылкой, «Принял» — подписанным обратным
   * вызовом, привязанным к этому чату и адресату (`opts.recipientUserId`).
   */
  async send(chatRef, message, opts): Promise<ChannelSendResult> {
    const { text, actions } = toChannelMessage(message)
    const replyMarkup = toInlineKeyboard(actions, {
      secret: actions ? actionSigningSecret() : null,
      chatId: chatRef,
      userId: opts?.recipientUserId,
    })
    const result = await getTelegramClient().sendMessage(chatRef, text, replyMarkup ? { replyMarkup } : {})
    if (result.ok) return { ok: true }
    return { ok: false, reason: result.reason }
  },

  linkUrl(): string | null {
    return null
  },

  parseInbound(): ParsedInbound | null {
    return null
  },
}
