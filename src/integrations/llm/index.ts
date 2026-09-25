import { getIntegrationsConfig } from '../config'
import { DisabledLlmProvider } from './disabled.provider'
import { GigaChatProvider } from './gigachat.provider'
import type { LlmProvider } from './provider'
import { YandexGptProvider } from './yandexgpt.provider'

export * from './provider'
export { DisabledLlmProvider } from './disabled.provider'
export { YandexGptProvider, parseYandexGptResponse, YANDEX_GPT_URL } from './yandexgpt.provider'
export {
  GigaChatProvider,
  parseGigaChatResponse,
  resetGigaChatToken,
  GIGACHAT_COMPLETIONS_URL,
  GIGACHAT_OAUTH_URL,
} from './gigachat.provider'
export { createHttpsTransport, type HttpsTransport } from '../https-transport'

/**
 * Активный провайдер ИИ-помощника выбирается переменной AI_ASSIST_PROVIDER
 * (`off` по умолчанию). Помощник знает только интерфейс и о реализации не знает.
 */
export function getLlmProvider(): LlmProvider {
  const config = getIntegrationsConfig()
  const { aiAssist } = config

  switch (aiAssist.provider) {
    case 'yandexgpt':
      return new YandexGptProvider(aiAssist.yandexGpt, aiAssist.timeoutMs, config.common.minIntervalMs)
    case 'gigachat':
      return new GigaChatProvider(aiAssist.gigaChat, aiAssist.timeoutMs)
    case 'off':
    default:
      return new DisabledLlmProvider()
  }
}
