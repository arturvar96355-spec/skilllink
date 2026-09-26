import { randomInt } from 'node:crypto'
import type { VkConfig } from '../config'
import { log } from '@/shared/log/logger'

/**
 * Отправка сообщений через VK API (messages.send, решение 144) от имени сообщества.
 *
 * `fetch` с `AbortController` на таймаут, три попытки с джиттером — как у клиента
 * MAX. Исключений наружу не бросает. Токен сообщества уходит параметром запроса
 * (так требует VK API) — `redact()` вырезает его из журнала на всякий случай, если
 * VK процитирует его в тексте ошибки.
 */

export type VkSendResult =
  | { ok: true }
  | {
      ok: false
      /** `disabled` — бот не настроен; `blocked` — получатель запретил сообщения от сообщества (900/901/902); `failed` — остальное. */
      reason: 'disabled' | 'blocked' | 'failed'
      status: number | null
      /** Код ошибки VK (error_code) — для журнала и «Проверить канал» в админке. */
      errorCode: number | null
    }

interface VkApiReply {
  response?: unknown
  error?: { error_code?: unknown; error_msg?: unknown }
}

export const VK_MAX_TEXT = 4096

const ATTEMPTS = 3
const BASE_PAUSE_MS = 300
const MAX_PAUSE_MS = 2000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function jitteredPause(attempt: number): number {
  const base = Math.min(BASE_PAUSE_MS * 2 ** (attempt - 1), MAX_PAUSE_MS)
  const jitter = base * 0.3 * (Math.random() * 2 - 1)
  return Math.max(0, Math.round(base + jitter))
}

/** Коды ошибок VK, после которых получатель недоступен — как 403 у Telegram/MAX. */
const BLOCKED_ERROR_CODES = new Set([900, 901, 902, 15])
/** Есть смысл повторить: перегрузка сервера и лимит частоты. */
const RETRYABLE_ERROR_CODES = new Set([6, 9, 10])

function parseReply(body: string): VkApiReply {
  try {
    const value: unknown = JSON.parse(body)
    return typeof value === 'object' && value !== null ? (value as VkApiReply) : {}
  } catch {
    return {}
  }
}

export interface VkClientOptions {
  fetchImpl?: typeof fetch
  wait?: (ms: number) => Promise<void>
  /** Генератор random_id (решение 144, дедупликация на стороне VK) — подменяется в тестах. */
  randomId?: () => number
}

export class VkClient {
  private readonly fetchImpl: typeof fetch
  private readonly wait: (ms: number) => Promise<void>
  private readonly randomId: () => number

  constructor(
    private readonly config: VkConfig,
    options: VkClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch
    // VK требует ненулевой диапазон int32 — randomInt(min, max) исключает max.
    this.randomId = options.randomId ?? (() => randomInt(-2_147_483_647, 2_147_483_647))
    this.wait = options.wait ?? sleep
  }

  get enabled(): boolean {
    return this.config.enabled
  }

  private redact(text: string): string {
    const token = this.config.groupToken
    return token ? text.split(token).join('[токен скрыт]') : text
  }

  private logAttempt(attempt: number, what: string): void {
    log.warn('[integration:vk] отправка не удалась', { attempt, attempts: ATTEMPTS, reason: this.redact(what) })
  }

  /**
   * @param chatRef — peer_id получателя в VK (id пользователя для личных сообщений).
   */
  async sendMessage(chatRef: string, text: string): Promise<VkSendResult> {
    const token = this.config.groupToken
    const groupId = this.config.groupId
    if (!token || !groupId) return { ok: false, reason: 'disabled', status: null, errorCode: null }

    const truncated = text.length > VK_MAX_TEXT ? `${text.slice(0, VK_MAX_TEXT - 1)}…` : text
    const params = new URLSearchParams({
      access_token: token,
      v: this.config.apiVersion,
      group_id: groupId,
      peer_id: chatRef,
      message: truncated,
      random_id: String(this.randomId()),
    })

    let lastStatus: number | null = null
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
      try {
        const response = await this.fetchImpl(`${this.config.apiBase}/messages.send`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
          signal: controller.signal,
        })
        lastStatus = response.status
        const reply = parseReply(await response.text())
        if (response.status === 200 && reply.response !== undefined && !reply.error) return { ok: true }

        const errorCode = typeof reply.error?.error_code === 'number' ? reply.error.error_code : null
        this.logAttempt(attempt, `HTTP ${response.status} error_code=${errorCode ?? '—'}`)
        if (errorCode !== null && BLOCKED_ERROR_CODES.has(errorCode)) {
          return { ok: false, reason: 'blocked', status: response.status, errorCode }
        }
        const retryable = response.status >= 500 || (errorCode !== null && RETRYABLE_ERROR_CODES.has(errorCode))
        if (!retryable) return { ok: false, reason: 'failed', status: response.status, errorCode }
      } catch (error) {
        this.logAttempt(attempt, error instanceof Error ? error.message : 'неизвестная ошибка')
      } finally {
        clearTimeout(timer)
      }
      if (attempt < ATTEMPTS) await this.wait(jitteredPause(attempt))
    }
    return { ok: false, reason: 'failed', status: lastStatus, errorCode: null }
  }
}
