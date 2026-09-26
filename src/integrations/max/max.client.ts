import type { MaxConfig } from '../config'
import { log } from '@/shared/log/logger'

/**
 * Отправка сообщений через Bot API MAX (мессенджер VK, решение 144).
 *
 * Транспорт — `fetch` с `AbortController` на таймаут: в отличие от Telegram
 * (integrations/telegram/telegram.client.ts) обходить DNS Yandex Cloud здесь не
 * нужно, обычного `fetch` достаточно. Исключений наружу клиент не бросает —
 * сбой MAX не должен ломать вызывающий код (решение 13).
 *
 * Токен передаётся в заголовке `Authorization` (не в адресе, как раньше у
 * Telegram) — значит, в тексте ошибки его не найти, но на всякий случай
 * `redact()` вырезает его и из тела ответа MAX, если он там процитирован.
 */

export type MaxSendResult =
  | { ok: true }
  | {
      ok: false
      /** `disabled` — бот не настроен; `blocked` — получатель недоступен (403/404); `failed` — остальное. */
      reason: 'disabled' | 'blocked' | 'failed'
      status: number | null
    }

interface MaxApiReply {
  code?: unknown
  message?: unknown
}

/** Предел длины текста MAX (по документации — 4000 символов). */
export const MAX_MAX_TEXT = 4000

/** Три попытки с джиттером (решение 144): сеть внешнего сервиса нестабильна, но ждать долго нельзя. */
const ATTEMPTS = 3
const BASE_PAUSE_MS = 300
const MAX_PAUSE_MS = 2000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Пауза с джиттером ±30%, чтобы одновременные повторы не били сервис синхронной волной. */
function jitteredPause(attempt: number): number {
  const base = Math.min(BASE_PAUSE_MS * 2 ** (attempt - 1), MAX_PAUSE_MS)
  const jitter = base * 0.3 * (Math.random() * 2 - 1)
  return Math.max(0, Math.round(base + jitter))
}

function isRetryable(status: number): boolean {
  return status >= 500 || status === 429 || status === 408
}

function parseReply(body: string): MaxApiReply {
  try {
    const value: unknown = JSON.parse(body)
    return typeof value === 'object' && value !== null ? (value as MaxApiReply) : {}
  } catch {
    return {}
  }
}

export interface MaxClientOptions {
  fetchImpl?: typeof fetch
  wait?: (ms: number) => Promise<void>
}

export class MaxClient {
  private readonly fetchImpl: typeof fetch
  private readonly wait: (ms: number) => Promise<void>

  constructor(
    private readonly config: MaxConfig,
    options: MaxClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.wait = options.wait ?? sleep
  }

  get enabled(): boolean {
    return this.config.enabled
  }

  /** Токен и всё, что на него похоже, — из текста ошибки перед журналом. */
  private redact(text: string): string {
    const token = this.config.botToken
    return token ? text.split(token).join('[токен скрыт]') : text
  }

  private logAttempt(attempt: number, what: string): void {
    log.warn('[integration:max] отправка не удалась', { attempt, attempts: ATTEMPTS, reason: this.redact(what) })
  }

  /**
   * @param chatRef — chat_id или user_id получателя в MAX (строкой; отправляется как user_id).
   */
  async sendMessage(chatRef: string, text: string): Promise<MaxSendResult> {
    const token = this.config.botToken
    if (!token) return { ok: false, reason: 'disabled', status: null }

    const body = JSON.stringify({
      text: text.length > MAX_MAX_TEXT ? `${text.slice(0, MAX_MAX_TEXT - 1)}…` : text,
    })
    const url = `${this.config.apiBase}/messages?user_id=${encodeURIComponent(chatRef)}`

    let lastStatus: number | null = null
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
      try {
        const response = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            authorization: token,
          },
          body,
          signal: controller.signal,
        })
        lastStatus = response.status
        const replyText = await response.text()
        if (response.status === 200) return { ok: true }

        const reply = parseReply(replyText)
        this.logAttempt(attempt, `HTTP ${response.status} ${typeof reply.code === 'string' ? reply.code : ''}`.trim())
        if (response.status === 403 || response.status === 404) return { ok: false, reason: 'blocked', status: response.status }
        if (!isRetryable(response.status)) return { ok: false, reason: 'failed', status: response.status }
      } catch (error) {
        this.logAttempt(attempt, error instanceof Error ? error.message : 'неизвестная ошибка')
      } finally {
        clearTimeout(timer)
      }
      if (attempt < ATTEMPTS) await this.wait(jitteredPause(attempt))
    }
    return { ok: false, reason: 'failed', status: lastStatus }
  }

  /**
   * Подписка на вебхук (POST /subscriptions, решение 144). Без повторов —
   * вызывает администратор и сразу видит результат, как rotateWebhookSecret у Telegram.
   */
  async subscribe(url: string, secret: string): Promise<{ ok: true } | { ok: false; status: number | null }> {
    const token = this.config.botToken
    if (!token) return { ok: false, status: null }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
    try {
      const response = await this.fetchImpl(`${this.config.apiBase}/subscriptions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: token },
        body: JSON.stringify({ url, secret, update_types: ['message_created', 'bot_started'] }),
        signal: controller.signal,
      })
      if (response.status === 200) return { ok: true }
      log.warn('[integration:max] подписка на вебхук отклонена', { status: response.status })
      return { ok: false, status: response.status }
    } catch (error) {
      log.warn('[integration:max] подписка на вебхук не выполнена', {
        reason: error instanceof Error ? this.redact(error.message) : 'неизвестная ошибка',
      })
      return { ok: false, status: null }
    } finally {
      clearTimeout(timer)
    }
  }
}
