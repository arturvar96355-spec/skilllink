import { getIntegrationsConfig } from '@/integrations/config'
import { getVkClient } from '@/integrations/vk'
import { vkCallbackEventSchema } from '../notify-channels.schema'
import { parseChannelCommand } from '../notify-channels.rules'
import type { ChannelAdapter, ChannelSendResult, ParsedInbound } from '../notify-channels.types'

/**
 * `club<id>` работает для любого сообщества без настроенного короткого имени
 * (dev.vk.com/ru/api/bots/getting-started). Метка `ref` возвращается VK в первом
 * входящем сообщении того, кто прошёл по ссылке (решение 144).
 */
function vkDeepLink(groupId: string, code: string): string {
  return `https://vk.me/club${encodeURIComponent(groupId)}?ref=${encodeURIComponent(code)}`
}

export const vkAdapter: ChannelAdapter = {
  id: 'vk',

  configured(): boolean {
    return getVkClient().enabled
  },

  async send(chatRef, text): Promise<ChannelSendResult> {
    const result = await getVkClient().sendMessage(chatRef, text)
    if (result.ok) return { ok: true }
    return { ok: false, reason: result.reason }
  },

  linkUrl(code): string | null {
    const { groupId } = getIntegrationsConfig().vk
    return groupId ? vkDeepLink(groupId, code) : null
  },

  parseInbound(update): ParsedInbound | null {
    const parsed = vkCallbackEventSchema.safeParse(update)
    if (!parsed.success) return null
    const data = parsed.data
    // `confirmation` не превращается в ParsedInbound — маршрут отвечает на него отдельно, до этого вызова.
    if (data.type !== 'message_new') return null

    const message = data.object?.message
    if (!message) return null
    const chatRef = String(message.from_id)
    const text = message.text ?? null
    return { chatRef, code: message.ref ?? undefined, command: parseChannelCommand(text) }
  },
}
