import { afterEach, describe, expect, it, vi } from 'vitest'
import { REQUEST_ID_HEADER } from '@/shared/http/request-id'
import { apiGet, apiPost, ApiRequestError } from './api'

/**
 * Понятные ошибки 429 и 500 (решение 183): `toApiError` строит текст не только
 * из тела ответа сервера, но и из заголовков `Retry-After` и `x-request-id` —
 * тех же, что ставит `handle.ts` и `rate-limit-guard.ts` на настоящем сервере.
 */

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('toApiError: 429 — по Retry-After', () => {
  it('текст с числом секунд из заголовка, даже если в теле другое число', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          429,
          { error: { code: 'RATE_LIMITED', message: 'Слишком много запросов. Подождите 999 с и повторите', details: { retryAfterSeconds: 999 } } },
          { 'Retry-After': '42' },
        ),
      ),
    )
    return apiGet('/api/universities').then(
      () => Promise.reject(new Error('должно было отклониться')),
      (error: unknown) => {
        expect(error).toBeInstanceOf(ApiRequestError)
        const apiError = error as ApiRequestError
        expect(apiError.code).toBe('RATE_LIMITED')
        expect(apiError.retryAfterSeconds).toBe(42)
        expect(apiError.message).toBe('Слишком много запросов, повторите через 42 с')
      },
    )
  })

  it('без заголовка — берётся число из details тела ответа', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(429, { error: { code: 'RATE_LIMITED', message: 'старый текст', details: { retryAfterSeconds: 7 } } })),
    )
    return apiPost('/api/universities', {}).then(
      () => Promise.reject(new Error('должно было отклониться')),
      (error: unknown) => {
        const apiError = error as ApiRequestError
        expect(apiError.message).toBe('Слишком много запросов, повторите через 7 с')
      },
    )
  })
})

describe('toApiError: 500 — номер запроса из ответа', () => {
  it('номер из тела (internalError кладёт его туда)', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(500, { error: { code: 'INTERNAL', message: 'Внутренняя ошибка сервера', requestId: 'req-abc-123' } })),
    )
    return apiGet('/api/universities').then(
      () => Promise.reject(new Error('должно было отклониться')),
      (error: unknown) => {
        const apiError = error as ApiRequestError
        expect(apiError.requestId).toBe('req-abc-123')
        expect(apiError.message).toBe('Ошибка сервера. Номер запроса: req-abc-123')
      },
    )
  })

  it('номера в теле нет — берётся заголовок x-request-id', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(500, { error: { code: 'INTERNAL', message: 'Внутренняя ошибка сервера' } }, { [REQUEST_ID_HEADER]: 'req-xyz-9' })),
    )
    return apiGet('/api/universities').then(
      () => Promise.reject(new Error('должно было отклониться')),
      (error: unknown) => {
        const apiError = error as ApiRequestError
        expect(apiError.message).toBe('Ошибка сервера. Номер запроса: req-xyz-9')
      },
    )
  })

  it('номера нигде нет — остаётся текст сервера, а не пустая ссылка на номер', () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500, { error: { code: 'INTERNAL', message: 'Внутренняя ошибка сервера' } })))
    return apiGet('/api/universities').then(
      () => Promise.reject(new Error('должно было отклониться')),
      (error: unknown) => {
        const apiError = error as ApiRequestError
        expect(apiError.requestId).toBeNull()
        expect(apiError.message).toBe('Внутренняя ошибка сервера')
      },
    )
  })
})

describe('toApiError: остальные коды — текст сервера как есть (FRONTEND.md, правило 5)', () => {
  it('422 и 409 не переписываются', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(409, { error: { code: 'INVALID_TRANSITION', message: 'Этап 7 — контрольная точка, сначала завершите этап 6' } })),
    )
    await expect(apiPost('/api/workflow/stages/1', {})).rejects.toMatchObject({
      message: 'Этап 7 — контрольная точка, сначала завершите этап 6',
      code: 'INVALID_TRANSITION',
      requestId: null,
      retryAfterSeconds: null,
    })
  })
})
