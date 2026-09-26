import { getTelegramClient } from '@/integrations/telegram'
import type { ChannelAdapter, ChannelSendResult, ParsedInbound } from '../notify-channels.types'

/**
 * Адаптер Telegram (решение 144) — тонкая обёртка над `@/integrations/telegram`
 * (клиент Bot API, публичный экспорт `getTelegramClient`), а не над
 * `src/modules/telegram` (бизнес-модуль решения 102/133 — в нём идёт параллельная
 * работа по другой ветке, его код этот адаптер не трогает и не импортирует).
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

  async send(chatRef, text): Promise<ChannelSendResult> {
    const result = await getTelegramClient().sendMessage(chatRef, text)
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
