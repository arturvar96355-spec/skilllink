import { request as httpsRequest, type RequestOptions } from 'node:https'
import type { ClientRequest, IncomingMessage } from 'node:http'

/**
 * POST по HTTPS через встроенный `node:https` — ради опций, которых нет у `fetch`
 * без отдельного пакета undici. Новых зависимостей нет.
 *
 * - `ca`: сертификат GigaChat выпущен НУЦ Минцифры, которого нет в стандартном
 *   наборе доверенных центров.
 * - `connectAddress`: из Yandex Cloud api.telegram.org по имени не отвечает, а по
 *   запасному IP отвечает (решение 102). Соединение идёт на IP, а имя сервера в TLS
 *   (SNI) и заголовок Host остаются из адреса запроса — сертификат проверяется
 *   на это имя как обычно, проверка не ослабляется.
 */
export interface HttpsPostRequest {
  url: string
  headers: Record<string, string>
  body: string
  timeoutMs: number
  /** Дополнительный доверенный сертификат (PEM). null — стандартный набор. */
  ca: string | Buffer | null
  /**
   * IP, на который открывать соединение вместо адреса из `url`. Имя из `url`
   * остаётся в SNI и Host, сертификат сверяется с ним. Не задан — обычный DNS.
   */
  connectAddress?: string | null
  /**
   * Прервать запрос досрочно (long polling `getUpdates`, решение 142): сигнал
   * сработал — запрос обрывается сразу, не дожидаясь `timeoutMs`. Без него —
   * обычный запрос, как раньше.
   */
  signal?: AbortSignal
}

export interface HttpsPostResponse {
  status: number
  body: string
}

export type HttpsTransport = (request: HttpsPostRequest) => Promise<HttpsPostResponse>

/** Ответ больше этого не читается: модели в ответ столько не пишут. */
const MAX_RESPONSE_BYTES = 1024 * 1024

export type RequestFn = (options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest

/**
 * Транспорт на `node:https`. Функция запроса подставляется в тестах — сети в них нет.
 * Таймаут — на весь запрос целиком, а не на простой сокета, как у опции `timeout`.
 */
export function createHttpsTransport(requestFn: RequestFn = httpsRequest): HttpsTransport {
  return (input) =>
    new Promise<HttpsPostResponse>((resolve, reject) => {
      const url = new URL(input.url)
      const connectAddress = input.connectAddress ?? null
      const request = requestFn(
        {
          protocol: url.protocol,
          hostname: connectAddress ?? url.hostname,
          port: url.port === '' ? (url.protocol === 'http:' ? 80 : 443) : Number(url.port),
          path: `${url.pathname}${url.search}`,
          method: 'POST',
          headers: {
            ...input.headers,
            // По IP Node сам не знает имени: без явного Host сервер Telegram
            // получил бы IP вместо имени.
            ...(connectAddress ? { host: url.host } : {}),
            'content-length': String(Buffer.byteLength(input.body)),
          },
          // Без servername TLS ушёл бы без SNI (по IP он не ставится), а сертификат
          // сверялся бы с IP и не прошёл. С ним — проверка на имя из адреса.
          ...(connectAddress ? { servername: url.hostname } : {}),
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

      const onAbort = (): void => {
        request.destroy(new Error('Запрос прерван'))
      }
      input.signal?.addEventListener('abort', onAbort, { once: true })

      request.on('error', (error) => {
        clearTimeout(timer)
        input.signal?.removeEventListener('abort', onAbort)
        reject(error)
      })
      request.on('close', () => input.signal?.removeEventListener('abort', onAbort))
      request.end(input.body)
    })
}
