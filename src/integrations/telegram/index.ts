import { TelegramClient } from './telegram.client'
import { effectiveTelegramConfig } from './runtime-config'

export * from './telegram.client'
export * from './runtime-config'

/**
 * Клиент по текущим настройкам — токен и имя бота из базы, если администратор
 * их задал (решение 142), иначе из env. Без токена он честно отвечает `disabled`.
 */
export function getTelegramClient(): TelegramClient {
  return new TelegramClient(effectiveTelegramConfig())
}
