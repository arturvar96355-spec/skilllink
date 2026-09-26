import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportClientError } from './report-error'

/**
 * Отчёт об ошибке фронтенда (решение 183): уходит на `/api/client-errors`
 * без строки запроса в адресе и без лишних полей — только то, что примет
 * `sanitizeClientError` (`shared/log/client-errors.ts`).
 */

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('reportClientError', () => {
  it('шлёт сообщение, стек, код и адрес без строки запроса', () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('window', {
      location: { origin: 'https://skilllink.example', pathname: '/cooperations/1', search: '?q=Иванов', hash: '#top' },
    })

    const error = Object.assign(new Error('Cannot read properties of undefined'), { digest: 'abc123' })
    reportClientError(error, 'app-error')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/client-errors')
    expect(init?.method).toBe('POST')
    const body = JSON.parse(init!.body as string)
    expect(body).toEqual({
      message: 'Cannot read properties of undefined',
      stack: error.stack,
      digest: 'abc123',
      url: 'https://skilllink.example/cooperations/1',
      component: 'app-error',
      level: 'error',
    })
  })

  it('на сервере (нет window) ничего не отправляет', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('window', undefined)

    reportClientError(new Error('boom'), 'global-error')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('сбой самой отправки не выбрасывается наружу', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))))
    vi.stubGlobal('window', { location: { origin: 'https://skilllink.example', pathname: '/' } })

    expect(() => reportClientError(new Error('boom'), 'global-error')).not.toThrow()
  })
})
