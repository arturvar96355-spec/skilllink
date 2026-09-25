import { z } from '@/shared/zod'
import { requestJson } from '../http-client'
import type { AiAssistConfig } from '../config'
import {
  LlmError,
  type LlmCompletion,
  type LlmProvider,
  type LlmProviderInfo,
  type LlmRequest,
} from './provider'

/**
 * YandexGPT — Yandex Foundation Models, основной провайдер помощника.
 * Стенд уже в Yandex Cloud: тот же облачный контур, данные не покидают РФ.
 *
 * Документация: https://yandex.cloud/ru/docs/foundation-models/text-generation/api-ref/TextGeneration/completion
 */
export const YANDEX_GPT_URL = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion'

/** Чем ниже, тем меньше модель «сочиняет»: нужен пересказ фактов, а не творчество. */
const TEMPERATURE = 0.3
/** Потолок длины ответа в токенах: сводке и письму хватает с запасом. */
const MAX_TOKENS = '800'

/** Ответ проверяется перед использованием: чужой формат — ошибка, а не пустой черновик. */
const responseSchema = z.object({
  result: z.object({
    alternatives: z
      .array(
        z.object({
          message: z.object({ text: z.string() }),
          status: z.string().optional(),
        }),
      )
      .min(1),
  }),
})

/**
 * Текст из ответа YandexGPT: `result.alternatives[0].message.text`.
 *
 * Статус `ALTERNATIVE_STATUS_CONTENT_FILTER` — модель отказалась отвечать, а текст
 * в ответе — вежливый отказ. Показывать его вместо черновика нельзя.
 */
export function parseYandexGptResponse(raw: unknown): string {
  const parsed = responseSchema.safeParse(raw)
  if (!parsed.success) throw new LlmError('error', 'YandexGPT вернул ответ неожиданного формата')

  const [first] = parsed.data.result.alternatives
  if (first!.status === 'ALTERNATIVE_STATUS_CONTENT_FILTER') {
    throw new LlmError('empty', 'YandexGPT отказался отвечать: сработал фильтр содержания')
  }
  const text = first!.message.text.trim()
  if (text === '') throw new LlmError('empty', 'YandexGPT вернул пустой ответ')
  return text
}

export class YandexGptProvider implements LlmProvider {
  constructor(
    private readonly settings: AiAssistConfig['yandexGpt'],
    private readonly timeoutMs: number,
    private readonly minIntervalMs: number,
  ) {}

  info(): LlmProviderInfo {
    const missing = [
      this.settings.apiKey ? null : 'YANDEX_GPT_API_KEY',
      this.settings.folderId ? null : 'YANDEX_FOLDER_ID',
    ].filter((name): name is string => name !== null)

    return {
      kind: 'yandexgpt',
      name: 'YandexGPT',
      ready: missing.length === 0,
      reason: missing.length === 0 ? null : `Не задано: ${missing.join(', ')}`,
      model: this.settings.model,
    }
  }

  /** Адрес модели в каталоге: `gpt://<каталог>/<модель>/latest`. */
  modelUri(): string {
    return `gpt://${this.settings.folderId ?? ''}/${this.settings.model}/latest`
  }

  async generate(request: LlmRequest): Promise<LlmCompletion> {
    const { apiKey, folderId } = this.settings
    if (!apiKey || !folderId) {
      throw new LlmError('error', 'YandexGPT не настроен: нет ключа или каталога')
    }

    const response = await requestJson<unknown>({
      service: 'yandexgpt',
      url: YANDEX_GPT_URL,
      method: 'POST',
      headers: {
        authorization: `Api-Key ${apiKey}`,
        'x-folder-id': folderId,
        // Не сохранять запросы на стороне Yandex Cloud для улучшения моделей:
        // персональных данных в них нет, но и рабочим фактам там делать нечего.
        'x-data-logging-enabled': 'false',
      },
      body: {
        modelUri: this.modelUri(),
        completionOptions: { stream: false, temperature: TEMPERATURE, maxTokens: MAX_TOKENS },
        messages: [
          { role: 'system', text: request.system },
          { role: 'user', text: request.user },
        ],
      },
      // Без повторов: человек ждёт у кнопки, а запасной шаблон готов сразу.
      config: { timeoutMs: this.timeoutMs, retries: 0, minIntervalMs: this.minIntervalMs },
    })

    return { text: parseYandexGptResponse(response), model: this.settings.model }
  }
}
