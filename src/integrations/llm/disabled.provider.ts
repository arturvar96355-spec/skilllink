import { LlmError, type LlmCompletion, type LlmProvider, type LlmProviderInfo } from './provider'

/**
 * Помощник выключен (`AI_ASSIST_PROVIDER=off`, значение по умолчанию).
 * В сеть не ходит; вызывающий код видит `ready: false` и пишет текст шаблоном.
 */
export class DisabledLlmProvider implements LlmProvider {
  info(): LlmProviderInfo {
    return {
      kind: 'off',
      name: 'ИИ-помощник выключен',
      ready: false,
      reason: 'Помощник выключен: AI_ASSIST_PROVIDER=off',
      model: null,
    }
  }

  async generate(): Promise<LlmCompletion> {
    throw new LlmError('error', 'ИИ-помощник выключен: AI_ASSIST_PROVIDER=off')
  }
}
