import { telegramAdapter } from './channels/telegram.adapter'
import { maxAdapter } from './channels/max.adapter'
import { vkAdapter } from './channels/vk.adapter'
import { CHANNEL_IDS, type ChannelAdapter, type ChannelId } from './notify-channels.types'

export { CHANNEL_IDS }

/** Реестр каналов уведомлений (решение 144): адаптер и заголовок на канал. */
export const CHANNEL_TITLES: Record<ChannelId, string> = {
  telegram: 'Telegram',
  max: 'MAX',
  vk: 'VK',
}

const ADAPTERS: Record<ChannelId, ChannelAdapter> = {
  telegram: telegramAdapter,
  max: maxAdapter,
  vk: vkAdapter,
}

export function adapterFor(id: ChannelId): ChannelAdapter {
  return ADAPTERS[id]
}

export function allAdapters(): readonly ChannelAdapter[] {
  return CHANNEL_IDS.map((id) => ADAPTERS[id])
}
