import { request as httpsRequest, type RequestOptions } from 'node:https'
import type { ClientRequest, IncomingMessage } from 'node:http'

/**
 * POST по HTTPS через встроенный `node:https` — ради одной опции: `ca`.
 *
 * Сертификат GigaChat выпущен НУЦ Минцифры, которого нет в стандартном наборе
 * доверенных центров. `fetch` в Node своего набора сертификатов на запрос не принимает
 * (нужен отдельный пакет undici), а `node:https` — принимает. Новых зависимостей нет.
 */
export interface HttpsPostRequest {
  url: string
  headers: Record<string, string>
  body: string
  timeoutMs: number
  /** Дополнительный доверенный сертификат (PEM). null — стандартный набор. */
  ca: string | Buffer | null
}

export interface HttpsPostResponse {
  status: number
  body: string
}

export type HttpsTransport = (request: HttpsPostRequest) => Promise<HttpsPostResponse>

/** Ответ больше этого не читается: модели в ответ столько не пишут. */
const MAX_RESPONSE_BYTES = 1024 * 1024

type RequestFn = (options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest

/**
 * Транспорт на `node:https`. Функция запроса подставляется в тестах — сети в них нет.
 * Таймаут — на весь запрос целиком, а не на простой сокета, как у опции `timeout`.
 */
export function createHttpsTransport(requestFn: RequestFn = httpsRequest): HttpsTransport {
  return (input) =>
    new Promise<HttpsPostResponse>((resolve, reject) => {
      const url = new URL(input.url)
      const request = requestFn(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port === '' ? 443 : Number(url.port),
          path: `${url.pathname}${url.search}`,
          method: 'POST',
          headers: { ...input.headers, 'content-length': String(Buffer.byteLength(input.body)) },
          ...(input.ca ? { ca: input.ca } : {}),
        },
        (response) => {
          const chunks: Buffer[] = []
          let size = 0
          response.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > MAX_RESPONSE_BYTES) {
              request.destroy(new Error('Ответ слишком большой'))
              return
            }
            chunks.push(chunk)
          })
          response.on('end', () => {
            clearTimeout(timer)
            resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
          })
          response.on('error', (error) => {
            clearTimeout(timer)
            reject(error)
          })
        },
      )

      const timer = setTimeout(() => {
        request.destroy(new Error(`Таймаут запроса: ${input.timeoutMs} мс`))
      }, input.timeoutMs)

      request.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      request.end(input.body)
    })
}
