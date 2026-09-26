import { getIntegrationsConfig } from '../config'
import { MaxClient } from './max.client'

export * from './max.client'

/** Клиент по текущим настройкам. Без токена он честно отвечает `disabled`. */
export function getMaxClient(): MaxClient {
  return new MaxClient(getIntegrationsConfig().max)
}
