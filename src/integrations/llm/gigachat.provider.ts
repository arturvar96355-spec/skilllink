import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { z } from '@/shared/zod'
import type { AiAssistConfig } from '../config'
import { createHttpsTransport, type HttpsTransport } from '../https-transport'
import {
  LlmError,
  type LlmCompletion,
  type LlmProvider,
  type LlmProviderInfo,
  type LlmRequest,
} from './provider'

/**
 * GigaChat — запасной российский провайдер помощника.
 *
 * Два шага: ключ авторизации меняется на токен доступа (живёт 30 минут и кэшируется),
 * с токеном идёт запрос к модели. Сертификат сервера выпущен НУЦ Минцифры —
 * его путь задаётся в GIGACHAT_CA_CERT_PATH.
 *
 * Документация: https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/gigachat-api
 */
export const GIGACHAT_OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth'
export const GIGACHAT_COMPLETIONS_URL = 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions'

const TEMPERATURE = 0.3
/** Токен обновляется за минуту до истечения: запрос с ним ещё успеет дойти. */
const TOKEN_REFRESH_MARGIN_MS = 60_000
/** Второму запросу — не меньше секунды, даже если получение токена съело почти весь таймаут. */
const MIN_REQUEST_TIMEOUT_MS = 1000

const tokenSchema = z.object({
  access_token: z.string().min(1),
  /** Момент истечения, мс с начала эпохи. */
  expires_at: z.number(),
})

const completionSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string() }),
        finish_reason: z.string().optional(),
      }),
    )
    .min(1),
})

/** Текст из ответа GigaChat: `choices[0].message.content`. */
export function parseGigaChatResponse(raw: unknown): { text: string; model: string | null } {
  const parsed = completionSchema.safeParse(raw)
  if (!parsed.success) throw new LlmError('error', 'GigaChat вернул ответ неожиданного формата')

  const [first] = parsed.data.choices
  // «blacklist» — модель отказалась отвечать на тему, текст — отказ, а не черновик.
  if (first!.finish_reason === 'blacklist') {
    throw new LlmError('empty', 'GigaChat отказался отвечать: сработал фильтр содержания')
  }
  const text = first!.message.content.trim()
  if (text === '') throw new LlmError('empty', 'GigaChat вернул пустой ответ')
  return { text, model: parsed.data.model ?? null }
}

/** Токен доступа живёт в памяти процесса и не пишется ни в журнал, ни на диск. */
let cachedToken: { authKey: string; scope: string; token: string; expiresAt: number } | null = null

/** Только для тестов: забыть токен. */
export function resetGigaChatToken(): void {
  cachedToken = null
}

function parseJson(body: string, what: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    throw new LlmError('error', `GigaChat: ${what} — не JSON`)
  }
}

export class GigaChatProvider implements LlmProvider {
  constructor(
    private readonly settings: AiAssistConfig['gigaChat'],
    private readonly timeoutMs: number,
    private readonly transport: HttpsTransport = createHttpsTransport(),
    private readonly now: () => number = Date.now,
  ) {}

  info(): LlmProviderInfo {
    return {
      kind: 'gigachat',
      name: 'GigaChat',
      ready: this.settings.authKey !== null,
      reason: this.settings.authKey === null ? 'Не задано: GIGACHAT_AUTH_KEY' : null,
      model: this.settings.model,
    }
  }

  /** Сертификат читается при каждом вызове: его можно подложить без перезапуска. */
  private ca(): Buffer | null {
    if (!this.settings.caCertPath) return null
    try {
      return readFileSync(this.settings.caCertPath)
    } catch {
      throw new LlmError('error', 'GigaChat: не прочитан файл сертификата из GIGACHAT_CA_CERT_PATH')
    }
  }

  private async accessToken(ca: Buffer | null, timeoutMs: number): Promise<string> {
    const authKey = this.settings.authKey!
    const { scope } = this.settings
    if (
      cachedToken &&
      cachedToken.authKey === authKey &&
      cachedToken.scope === scope &&
      cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS > this.now()
    ) {
      return cachedToken.token
    }

    const response = await this.transport({
      url: GIGACHAT_OAUTH_URL,
      headers: {
        authorization: `Basic ${authKey}`,
        RqUID: randomUUID(),
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams({ scope }).toString(),
      timeoutMs,
      ca,
    })
    // Тело ответа об ошибке в журнал не идёт: в нём бывает эхо запроса.
    if (response.status < 200 || response.status >= 300) {
      throw new LlmError('error', `GigaChat: получение токена — HTTP ${response.status}`)
    }

    const parsed = tokenSchema.safeParse(parseJson(response.body, 'ответ на получение токена'))
    if (!parsed.success) throw new LlmError('error', 'GigaChat: токен неожиданного формата')

    cachedToken = {
      authKey,
      scope,
      token: parsed.data.access_token,
      expiresAt: parsed.data.expires_at,
    }
    return parsed.data.access_token
  }

  async generate(request: LlmRequest): Promise<LlmCompletion> {
    if (!this.settings.authKey) throw new LlmError('error', 'GigaChat не настроен: нет ключа')

    const startedAt = this.now()
    const ca = this.ca()
    const token = await this.accessToken(ca, this.timeoutMs)
    const left = Math.max(MIN_REQUEST_TIMEOUT_MS, this.timeoutMs - (this.now() - startedAt))

    const response = await this.transport({
      url: GIGACHAT_COMPLETIONS_URL,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        model: this.settings.model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        temperature: TEMPERATURE,
      }),
      timeoutMs: left,
      ca,
    })

    if (response.status === 401) {
      // Токен отозван раньше срока — в следующий раз получим новый.
      cachedToken = null
    }
    if (response.status < 200 || response.status >= 300) {
      throw new LlmError('error', `GigaChat ответил ошибкой: HTTP ${response.status}`)
    }

    const { text, model } = parseGigaChatResponse(parseJson(response.body, 'ответ модели'))
    return { text, model: model ?? this.settings.model }
  }
}
