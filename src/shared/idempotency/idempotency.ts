import { createHash } from 'node:crypto'
import {
  IDEMPOTENCY,
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_REPLAYED_HEADER,
} from '@/shared/config/idempotency.config'
import { conflict, validationError } from '@/shared/http/errors'
import { MAX_JSON_BODY_BYTES, readBodyBytes } from '@/shared/http/request'
import { log } from '@/shared/log/logger'
import * as repo from './idempotency.repo'

/**
 * Ключ идемпотентности для POST-созданий (решение 133).
 *
 * Клиент присылает `Idempotency-Key` (обычно UUID) — и повтор того же запроса
 * (двойной щелчок, обрыв сети, повтор после таймаута) не создаёт вторую связку,
 * встречу или документ:
 *
 * - тот же ключ и то же тело — сохранённый ответ (`Idempotency-Replayed: true`);
 * - тот же ключ и другое тело — 422: ключ уже потрачен на другой запрос;
 * - запрос с этим ключом ещё выполняется — 409;
 * - без заголовка — всё как раньше.
 *
 * Ключ принадлежит пользователю (PK user_id + key) и живёт 24 часа. Сохраняется
 * только успешный ответ (2xx): после ошибки ключ отпускается, и исправленный
 * повтор выполняется заново. Захват ключа — вставка `ON CONFLICT DO NOTHING`,
 * поэтому из одновременных запросов выполняется ровно один.
 *
 * Обёртка — отдельная функция, а не часть `handle()`: ей нужен пользователь,
 * а общая обёртка маршрутов о нём не знает.
 */

export type IdempotencyStore = Pick<typeof repo, 'deleteExpired' | 'tryClaim' | 'find' | 'complete' | 'release'>

/** Печатные ASCII без пробела: так ключ безопасно ложится и в журнал, и в базу. */
const KEY_PATTERN = /^[\x21-\x7E]+$/

function readKey(request: Request): string | null {
  const raw = request.headers.get(IDEMPOTENCY_HEADER)
  if (raw === null) return null
  const key = raw.trim()
  if (key.length === 0 || key.length > IDEMPOTENCY.maxKeyLength || !KEY_PATTERN.test(key)) {
    throw validationError('Некорректный ключ идемпотентности', [
      {
        field: 'Idempotency-Key',
        message: `От 1 до ${IDEMPOTENCY.maxKeyLength} печатных латинских знаков без пробелов, например UUID`,
      },
    ])
  }
  return key
}

/** Хеш запроса: метод, путь с параметрами и тело байтами. */
export function requestHash(method: string, url: string, body: Uint8Array): string {
  const { pathname, search } = new URL(url)
  return createHash('sha256').update(`${method}\n${pathname}${search}\n`).update(body).digest('hex')
}

function replay(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', [IDEMPOTENCY_REPLAYED_HEADER]: 'true' },
  })
}

const tooLarge = () =>
  validationError('Тело запроса слишком большое', [
    { field: '_', message: `Допустимо не больше ${MAX_JSON_BODY_BYTES / 1024 / 1024} МБ` },
  ])

export async function withIdempotency(
  request: Request,
  userId: string,
  run: (request: Request) => Promise<Response>,
  store: IdempotencyStore = repo,
  now: () => Date = () => new Date(),
): Promise<Response> {
  const key = readKey(request)
  if (key === null) return run(request)

  const body = await readBodyBytes(request, MAX_JSON_BODY_BYTES, tooLarge)
  const hash = requestHash(request.method, request.url, body)
  // Тело уже прочитано — обработчику отдаётся копия запроса с тем же телом.
  const fresh = () =>
    new Request(request.url, { method: request.method, headers: request.headers, body: body.byteLength > 0 ? new Uint8Array(body) : null })

  await store.deleteExpired(userId, key, new Date(now().getTime() - IDEMPOTENCY.ttlMs))

  let claimed = await store.tryClaim(userId, key, hash)
  if (!claimed) {
    const existing = await store.find(userId, key)
    // Запись исчезла между вставкой и чтением (отпущена после ошибки) — пробуем ещё раз.
    if (!existing) claimed = await store.tryClaim(userId, key, hash)
    else {
      if (existing.requestHash !== hash) {
        throw validationError('Ключ идемпотентности уже использован для другого запроса', [
          { field: 'Idempotency-Key', message: 'С этим ключом уже отправлен запрос с другим телом. Для нового запроса — новый ключ' },
        ])
      }
      if (existing.status === 'IN_PROGRESS' || existing.responseStatus === null) {
        throw conflict('Запрос с этим ключом ещё выполняется — дождитесь ответа')
      }
      return replay(existing.responseStatus, existing.responseBody)
    }
    if (!claimed) throw conflict('Запрос с этим ключом ещё выполняется — дождитесь ответа')
  }

  let response: Response
  try {
    response = await run(fresh())
  } catch (error) {
    await store.release(userId, key).catch(() => undefined)
    throw error
  }

  if (response.status < 200 || response.status >= 300) {
    await store.release(userId, key).catch(() => undefined)
    return response
  }

  try {
    const text = await response.clone().text()
    if (text.length > IDEMPOTENCY.maxStoredResponseBytes) {
      // Слишком большой ответ не храним: ключ отпускается, повтор выполнится заново.
      await store.release(userId, key)
      return response
    }
    await store.complete(userId, key, response.status, text === '' ? null : JSON.parse(text))
  } catch (error) {
    // Ответ уже есть — отдаём его; ключ отпускаем, чтобы повтор не висел в 409.
    log.warn('[idempotency] ответ не сохранён', { err: error })
    await store.release(userId, key).catch(() => undefined)
  }
  return response
}
