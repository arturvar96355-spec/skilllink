import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { TelegramConfig } from '../config'
import { createHttpsTransport, type HttpsTransport } from '../https-transport'
import { log } from '@/shared/log/logger'

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
  description?: unknown
  parameters?: { retry_after?: unknown }
}

/** Итог setWebhook: без повторов — его вызывает администратор и видит результат сразу. */
export type TelegramSetWebhookResult =
  | { ok: true }
  | { ok: false; reason: 'disabled' | 'failed'; status: number | null; description: string | null }

/** Итог getMe — проверка токена (решение 142, смена токена в админке). */
export type TelegramGetMeResult =
  | { ok: true; username: string }
  | { ok: false; reason: 'disabled' | 'failed'; status: number | null; description: string | null }

/** Итог deleteWebhook — перед стартом long polling (решение 142): вебхук и polling не работают одновременно. */
export type TelegramDeleteWebhookResult =
  | { ok: true }
  | { ok: false; reason: 'disabled' | 'failed'; status: number | null; description: string | null }

/** `getWebhookInfo` — для админки и для решения auto-режима, свежий ли вебхук. */
export interface TelegramWebhookInfo {
  url: string
  pendingUpdateCount: number
  lastErrorDate: Date | null
  lastErrorMessage: string | null
}

export type TelegramGetWebhookInfoResult =
  | { ok: true; info: TelegramWebhookInfo }
  | { ok: false; reason: 'disabled' | 'failed'; status: number | null }

/** Одно обновление `getUpdates` — тело не проверяется здесь, это делает `telegramUpdateSchema`. */
export type TelegramRawUpdate = Record<string, unknown>

export type TelegramGetUpdatesResult =
  | { ok: true; updates: TelegramRawUpdate[] }
  | { ok: false; reason: 'disabled' | 'aborted' | 'failed'; status: number | null; description: string | null }

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
    log.warn('[integration:telegram] sendMessage не удался', { attempt, attempts: ATTEMPTS, reason: this.redact(what) })
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

  /**
   * Назначить адрес вебхука и секрет заголовка (решение 133, смена секрета).
   * Секрет уходит только в теле запроса к Telegram; ни в журнал, ни в результат
   * он не попадает. Остальные настройки вебхука (allowed_updates и др.) Telegram
   * сохраняет прежними — их мы не передаём.
   */
  async setWebhook(url: string, secretToken: string): Promise<TelegramSetWebhookResult> {
    const token = this.config.botToken
    if (!token) return { ok: false, reason: 'disabled', status: null, description: null }
    try {
      const response = await this.transport({
        url: `${this.config.apiBase}/bot${token}/setWebhook`,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ url, secret_token: secretToken }),
        timeoutMs: this.config.timeoutMs,
        ca: null,
        connectAddress: this.config.apiIp,
      })
      const reply = parseReply(response.body)
      if (response.status === 200 && reply.ok === true) return { ok: true }
      const description =
        typeof reply.description === 'string' ? this.redact(reply.description).split(secretToken).join('[скрыто]').slice(0, 200) : null
      log.warn('[integration:telegram] setWebhook отклонён', { status: response.status, description })
      return { ok: false, reason: 'failed', status: response.status, description }
    } catch (error) {
      const reason = error instanceof Error ? this.redact(error.message) : 'неизвестная ошибка'
      log.warn('[integration:telegram] setWebhook не выполнен', { reason })
      return { ok: false, reason: 'failed', status: null, description: null }
    }
  }

  /** Токен верный и бот существует — для смены токена в админке (решение 142). */
  async getMe(): Promise<TelegramGetMeResult> {
    const token = this.config.botToken
    if (!token) return { ok: false, reason: 'disabled', status: null, description: null }
    try {
      const response = await this.transport({
        url: `${this.config.apiBase}/bot${token}/getMe`,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: '{}',
        timeoutMs: this.config.timeoutMs,
        ca: null,
        connectAddress: this.config.apiIp,
      })
      const reply = parseReply(response.body) as BotApiReply & { result?: { username?: unknown } }
      if (response.status === 200 && reply.ok === true && typeof reply.result?.username === 'string') {
        return { ok: true, username: reply.result.username }
      }
      const description = typeof reply.description === 'string' ? this.redact(reply.description).slice(0, 200) : null
      return { ok: false, reason: 'failed', status: response.status, description }
    } catch (error) {
      return {
        ok: false,
        reason: 'failed',
        status: null,
        description: error instanceof Error ? this.redact(error.message) : null,
      }
    }
  }

  /**
   * Снять вебхук перед стартом long polling (решение 142): у Telegram активны
   * либо вебхук, либо `getUpdates` — оставленный вебхук иначе забирал бы
   * обновления первым, и polling не увидел бы ничего.
   */
  async deleteWebhook(): Promise<TelegramDeleteWebhookResult> {
    const token = this.config.botToken
    if (!token) return { ok: false, reason: 'disabled', status: null, description: null }
    try {
      const response = await this.transport({
        url: `${this.config.apiBase}/bot${token}/deleteWebhook`,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: '{}',
        timeoutMs: this.config.timeoutMs,
        ca: null,
        connectAddress: this.config.apiIp,
      })
      const reply = parseReply(response.body)
      if (response.status === 200 && reply.ok === true) return { ok: true }
      log.warn('[integration:telegram] deleteWebhook отклонён', { status: response.status })
      return { ok: false, reason: 'failed', status: response.status, description: null }
    } catch (error) {
      log.warn('[integration:telegram] deleteWebhook не выполнен', {
        reason: error instanceof Error ? this.redact(error.message) : 'неизвестная ошибка',
      })
      return { ok: false, reason: 'failed', status: null, description: null }
    }
  }

  /** Адрес вебхука, необработанные обновления и последняя ошибка — для админки и auto-режима. */
  async getWebhookInfo(): Promise<TelegramGetWebhookInfoResult> {
    const token = this.config.botToken
    if (!token) return { ok: false, reason: 'disabled', status: null }
    try {
      const response = await this.transport({
        url: `${this.config.apiBase}/bot${token}/getWebhookInfo`,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: '{}',
        timeoutMs: this.config.timeoutMs,
        ca: null,
        connectAddress: this.config.apiIp,
      })
      const reply = parseReply(response.body) as BotApiReply & {
        result?: {
          url?: unknown
          pending_update_count?: unknown
          last_error_date?: unknown
          last_error_message?: unknown
        }
      }
      if (response.status !== 200 || reply.ok !== true || !reply.result) {
        return { ok: false, reason: 'failed', status: response.status }
      }
      const result = reply.result
      return {
        ok: true,
        info: {
          url: typeof result.url === 'string' ? result.url : '',
          pendingUpdateCount: typeof result.pending_update_count === 'number' ? result.pending_update_count : 0,
          lastErrorDate: typeof result.last_error_date === 'number' ? new Date(result.last_error_date * 1000) : null,
          lastErrorMessage: typeof result.last_error_message === 'string' ? result.last_error_message : null,
        },
      }
    } catch {
      return { ok: false, reason: 'failed', status: null }
    }
  }

  /**
   * Long polling (решение 142): ждёт до `timeoutSec` секунд у Telegram, пока не
   * появится хотя бы одно обновление, начиная с `offset`. `signal` прерывает
   * ожидание досрочно — аккуратная остановка по SIGTERM не должна ждать до
   * четверти минуты. Локальный таймаут запроса — с запасом поверх `timeoutSec`,
   * иначе транспорт оборвал бы соединение раньше, чем ответит сам Telegram.
   */
  async getUpdates(options: { offset?: number; timeoutSec: number; signal?: AbortSignal }): Promise<TelegramGetUpdatesResult> {
    const token = this.config.botToken
    if (!token) return { ok: false, reason: 'disabled', status: null, description: null }
    try {
      const response = await this.transport({
        url: `${this.config.apiBase}/bot${token}/getUpdates`,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          offset: options.offset,
          timeout: options.timeoutSec,
          allowed_updates: ['message'],
        }),
        timeoutMs: (options.timeoutSec + 10) * 1000,
        ca: null,
        connectAddress: this.config.apiIp,
        signal: options.signal,
      })
      const reply = parseReply(response.body) as BotApiReply & { result?: unknown }
      if (response.status === 200 && reply.ok === true && Array.isArray(reply.result)) {
        return { ok: true, updates: reply.result as TelegramRawUpdate[] }
      }
      const description = typeof reply.description === 'string' ? this.redact(reply.description).slice(0, 200) : null
      return { ok: false, reason: 'failed', status: response.status, description }
    } catch (error) {
      if (options.signal?.aborted) return { ok: false, reason: 'aborted', status: null, description: null }
      return {
        ok: false,
        reason: 'failed',
        status: null,
        description: error instanceof Error ? this.redact(error.message) : 'неизвестная ошибка',
      }
    }
  }
}
