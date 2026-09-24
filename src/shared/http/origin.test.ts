import { afterEach, describe, expect, it, vi } from 'vitest'
import { handle } from './handle'
import { ok } from './response'
import { isAllowedOrigin } from './origin'

const SITE = 'https://skilllink.site'

const check = (method: string, origin: string | null, host: string | null = 'skilllink.site') => ({
  method,
  origin,
  hosts: [null, host],
  siteUrl: SITE,
})

describe('проверка источника изменяющего запроса', () => {
  it('чтение не проверяется', () => {
    expect(isAllowedOrigin(check('GET', 'https://evil.example'))).toBe(true)
    expect(isAllowedOrigin(check('HEAD', 'https://evil.example'))).toBe(true)
    expect(isAllowedOrigin(check('OPTIONS', 'https://evil.example'))).toBe(true)
  })

  it('запрос со своего сайта проходит', () => {
    expect(isAllowedOrigin(check('POST', 'https://skilllink.site'))).toBe(true)
    expect(isAllowedOrigin(check('PATCH', 'https://skilllink.site'))).toBe(true)
  })

  it('без AUTH_URL свой сайт узнаётся по хосту запроса', () => {
    expect(
      isAllowedOrigin({ method: 'POST', origin: 'http://localhost:3000', hosts: [null, 'localhost:3000'], siteUrl: undefined }),
    ).toBe(true)
  })

  it('запрос со страницы чужого сайта отклоняется', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(isAllowedOrigin(check(method, 'https://evil.example')), method).toBe(false)
    }
    // Похожий адрес — не наш: сравнивается источник целиком, а не начало строки.
    expect(isAllowedOrigin(check('POST', 'https://skilllink.site.evil.example'))).toBe(false)
  })

  it('непрозрачный источник «null» отклоняется', () => {
    expect(isAllowedOrigin(check('POST', 'null'))).toBe(false)
  })

  it('без заголовка Origin пропускается — так ходят скрипты, а не браузер', () => {
    expect(isAllowedOrigin(check('POST', null))).toBe(true)
  })
})

describe('обработчик маршрута', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const route = handle(async () => ok({ done: true }))

  it('отвечает 403 на изменяющий запрос с чужого сайта и не вызывает обработчик', async () => {
    vi.stubEnv('AUTH_URL', SITE)
    const called = vi.fn(async () => ok({ done: true }))
    const response = await handle(called)(
      new Request(`${SITE}/api/universities`, {
        method: 'POST',
        headers: { origin: 'https://evil.example', host: 'skilllink.site' },
      }),
      undefined,
    )
    expect(response.status).toBe(403)
    expect(called).not.toHaveBeenCalled()
  })

  it('свой сайт и запрос без Origin проходят', async () => {
    vi.stubEnv('AUTH_URL', SITE)
    const own = await route(
      new Request(`${SITE}/api/universities`, { method: 'POST', headers: { origin: SITE } }),
      undefined,
    )
    const script = await route(new Request(`${SITE}/api/universities`, { method: 'POST' }), undefined)
    expect(own.status).toBe(200)
    expect(script.status).toBe(200)
  })
})
