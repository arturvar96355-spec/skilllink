import { getIntegrationsConfig } from '@/integrations/config'
import { getMaxClient } from '@/integrations/max'
import { maxUpdateSchema } from '../notify-channels.schema'
import { extractStartCode, parseChannelCommand } from '../notify-channels.rules'
import type { ChannelAdapter, ChannelSendResult, ParsedInbound } from '../notify-channels.types'

/** Адрес диплинка MAX — по документации на момент написания (см. notify-channels.schema.ts). */
function maxDeepLink(botUsername: string, code: string): string {
  return `https://max.ru/${encodeURIComponent(botUsername)}/start/${encodeURIComponent(code)}`
}

export const maxAdapter: ChannelAdapter = {
  id: 'max',

  configured(): boolean {
    return getMaxClient().enabled
  },

  async send(chatRef, text): Promise<ChannelSendResult> {
    const result = await getMaxClient().sendMessage(chatRef, text)
    if (result.ok) return { ok: true }
    return { ok: false, reason: result.reason }
  },

  linkUrl(code): string | null {
    const { botUsername } = getIntegrationsConfig().max
    return botUsername ? maxDeepLink(botUsername, code) : null
  },

  parseInbound(update): ParsedInbound | null {
    const parsed = maxUpdateSchema.safeParse(update)
    if (!parsed.success) return null
    const data = parsed.data

    const chatRefRaw =
      data.message?.sender?.user_id ?? data.message?.recipient?.user_id ?? data.user?.user_id ?? data.chat_id
    if (chatRefRaw === undefined) return null
    const chatRef = String(chatRefRaw)
    const username = data.user?.username ?? data.message?.sender?.username ?? null

    if (data.update_type === 'bot_started') {
      const code = data.payload ?? undefined
      return { chatRef, code, username }
    }
    if (data.update_type === 'message_created') {
      const text = data.message?.body?.text ?? null
      const code = extractStartCode(text) ?? undefined
      return { chatRef, code, username, command: parseChannelCommand(text) }
    }
    // Прочие события (правка сообщения, реакции и т.п.) — не наши, но чат известен:
    // дедупликация и «событие пропущено» в журнале важнее молчаливого null.
    return { chatRef, username, ignored: true }
  },
}
