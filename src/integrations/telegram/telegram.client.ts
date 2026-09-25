import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { TelegramConfig } from '../config'
import { createHttpsTransport, type HttpsTransport } from '../https-transport'

/**
 * Отправка сообщений через Telegram Bot API (решение 102).
 *
 * Бизнес-логика знает только `sendMessage`: что отправить, решает модуль
 * `telegram`, как доставить — этот клиент. Исключений наружу он не бросает:
 * Telegram недоступен — сводка не ушла, об этом строка в журнале, а приложение
 * работает дальше (решение 13).
 *
 * Транспорт — `node:https`, а не `fetch`: из Yandex Cloud api.telegram.org по имени
 * не отвечает, и соединение приходится вести на запасной IP с прежним именем
 * в SNI и Host (TELEGRAM_API_IP). У `fetch` такой настройки без пакета undici нет.
 */

export type TelegramSendResult =
  | { ok: true }
  | {
      ok: false
      /**
       * `disabled` — бот не настроен; `blocked` — человек остановил бота или удалил
       * аккаунт (403), писать ему бессмысленно; `failed` — остальное.
       */
      reason: 'disabled' | 'blocked' | 'failed'
      status: number | null
    }

/** Ответ Bot API: `ok` и при ошибке код, описание и совет подождать. */
interface BotApiReply {
  ok?: unknown
  error_code?: unknown
  parameters?: { retry_after?: unknown }
}

/** Одна повторная попытка: сводка раз в день, долго биться незачем. */
const ATTEMPTS = 2
/** Пауза перед повтором, если Telegram не сказал, сколько ждать. */
const RETRY_PAUSE_MS = 1000
/** Дольше этого не ждём даже по просьбе Telegram (429 retry_after). */
const MAX_RETRY_PAUSE_MS = 5000
/** Предел длины текста у Bot API — 4096 символов. */
export const TELEGRAM_MAX_TEXT = 4096

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function parseReply(body: string): BotApiReply {
  try {
    const value: unknown = JSON.parse(body)
    return typeof value === 'object' && value !== null ? (value as BotApiReply) : {}
  } catch {
    return {}
  }
}

/** Повторять имеет смысл сетевой сбой, 5xx и 429 — как в http-client.ts. */
function isRetryable(status: number): boolean {
  return status >= 500 || status === 429 || status === 408
}

export interface TelegramClientOptions {
  transport?: HttpsTransport
  /** Пауза между попытками — подменяется в тестах. */
  wait?: (ms: number) => Promise<void>
}

export class TelegramClient {
  private readonly transport: HttpsTransport
  private readonly wait: (ms: number) => Promise<void>

  constructor(
    private readonly config: TelegramConfig,
    options: TelegramClientOptions = {},
  ) {
    // http:// — только для заглушки на своей машине; настоящий Bot API — https.
    this.transport =
      options.transport ??
      createHttpsTransport(config.apiBase.startsWith('http:') ? httpRequest : httpsRequest)
    this.wait = options.wait ?? sleep
  }

  get enabled(): boolean {
    return this.config.botToken !== null
  }

  /** Токен в адресе запроса — из текста ошибки он вырезается. */
  private redact(text: string): string {
    const token = this.config.botToken
    return token ? text.split(token).join('[токен скрыт]') : text
  }

  private log(attempt: number, what: string): void {
    // Без текста сообщения, идентификатора чата и токена — только что случилось.
    console.warn(`[integration:telegram] sendMessage, попытка ${attempt}/${ATTEMPTS}: ${this.redact(what)}`)
  }

  async sendMessage(chatId: string, text: string): Promise<TelegramSendResult> {
    const token = this.config.botToken
    if (!token) return { ok: false, reason: 'disabled', status: null }

    const body = JSON.stringify({
      chat_id: chatId,
      text: text.length > TELEGRAM_MAX_TEXT ? `${text.slice(0, TELEGRAM_MAX_TEXT - 1)}…` : text,
      // Ссылки на стенд — не повод для карточки предпросмотра под каждым сообщением.
      link_preview_options: { is_disabled: true },
    })

    let lastStatus: number | null = null
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      let pause = RETRY_PAUSE_MS
      try {
        const response = await this.transport({
          url: `${this.config.apiBase}/bot${token}/sendMessage`,
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body,
          timeoutMs: this.config.timeoutMs,
          ca: null,
          connectAddress: this.config.apiIp,
        })
        lastStatus = response.status
        const reply = parseReply(response.body)
        if (response.status === 200 && reply.ok === true) return { ok: true }

        this.log(attempt, `HTTP ${response.status}`)
        if (response.status === 403) return { ok: false, reason: 'blocked', status: 403 }
        if (!isRetryable(response.status)) return { ok: false, reason: 'failed', status: response.status }

        const retryAfter = Number(reply.parameters?.retry_after)
        if (Number.isFinite(retryAfter) && retryAfter > 0) pause = Math.min(retryAfter * 1000, MAX_RETRY_PAUSE_MS)
      } catch (error) {
        // Таймаут, обрыв, отказ TLS: сообщение Node без тела и без токена.
        this.log(attempt, error instanceof Error ? error.message : 'неизвестная ошибка')
      }
      if (attempt < ATTEMPTS) await this.wait(pause)
    }
    return { ok: false, reason: 'failed', status: lastStatus }
  }
}
