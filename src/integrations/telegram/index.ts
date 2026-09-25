import { getIntegrationsConfig } from '../config'
import { TelegramClient } from './telegram.client'

export * from './telegram.client'

/** Клиент по текущим настройкам. Без токена он честно отвечает `disabled`. */
export function getTelegramClient(): TelegramClient {
  return new TelegramClient(getIntegrationsConfig().telegram)
}
