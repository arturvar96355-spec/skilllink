import { integrationError } from '@/shared/http/errors'
import type { IntegrationCommonConfig } from './config'

/**
 * Клиент внешних интеграций: таймаут, повторы, ограничение частоты и журналирование.
 *
 * Отдельный слой нужен, чтобы ни один модуль бизнес-логики не знал про fetch,
 * заголовки и токены. Заменить mock на реальный сервис можно, не трогая сервисы.
 */

/** Время последнего запроса к каждому сервису: основа ограничения частоты. */
const lastCallAt = new Map<string, number>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Пауза, чтобы выдержать минимальный интервал между запросами к одному сервису. */
async function respectRateLimit(service: string, minIntervalMs: number): Promise<void> {
  const previous = lastCallAt.get(service)
  const now = Date.now()

  if (previous !== undefined) {
    const elapsed = now - previous
    if (elapsed < minIntervalMs) await sleep(minIntervalMs - elapsed)
  }
  lastCallAt.set(service, Date.now())
}

/** Только для тестов: сбросить накопленное состояние ограничителя. */
export function resetRateLimiter(): void {
  lastCallAt.clear()
}

export interface RequestOptions {
  service: string
  url: string
  method?: string
  token?: string | null
  /**
   * Дополнительные заголовки. Нужны сервисам со своей схемой авторизации:
   * YandexGPT ждёт `Authorization: Api-Key …` и `x-folder-id`, а не Bearer.
   */
  headers?: Record<string, string>
  body?: unknown
  config: IntegrationCommonConfig
}

/** Повторять имеет смысл только сетевые сбои и временные ошибки сервера. */
function isRetryable(status: number): boolean {
  return status >= 500 || status === 408 || status === 429
}

export async function requestJson<T>(options: RequestOptions): Promise<T> {
  const { service, url, method = 'GET', token, headers, body, config } = options
  const attempts = config.retries + 1

  let lastError = ''

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await respectRateLimit(service, config.minIntervalMs)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeoutMs)

    try {
      const response = await fetch(url, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      })

      if (!response.ok) {
        lastError = `HTTP ${response.status}`
        // Журналируем без тела ответа: в нём могут быть персональные данные.
        console.warn(`[integration:${service}] попытка ${attempt}/${attempts}: ${lastError}`)

        if (isRetryable(response.status) && attempt < attempts) {
          await sleep(config.minIntervalMs * attempt)
          continue
        }
        throw integrationError(`Внешний сервис ${service} ответил ошибкой: ${lastError}`)
      }

      return (await response.json()) as T
    } catch (error) {
      // Ошибка, уже приведённая к формату контракта, повторам не подлежит.
      if (error instanceof Error && error.name === 'AppError') throw error

      lastError = error instanceof Error ? error.message : 'неизвестная ошибка'
      console.warn(`[integration:${service}] попытка ${attempt}/${attempts}: ${lastError}`)

      if (attempt < attempts) {
        await sleep(config.minIntervalMs * attempt)
        continue
      }
      throw integrationError(`Внешний сервис ${service} недоступен: ${lastError}`)
    } finally {
      clearTimeout(timer)
    }
  }

  throw integrationError(`Внешний сервис ${service} недоступен: ${lastError}`)
}
