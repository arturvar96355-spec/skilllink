import { getIntegrationsConfig } from '../config'
import { VkClient } from './vk.client'

export * from './vk.client'

/** Клиент по текущим настройкам. Без токена он честно отвечает `disabled`. */
export function getVkClient(): VkClient {
  return new VkClient(getIntegrationsConfig().vk)
}
