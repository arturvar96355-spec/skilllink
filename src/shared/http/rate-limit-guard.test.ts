import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RATE_LIMITS } from '@/shared/config/rate-limit.config'

/**
 * Ограничение частоты в обёртке маршрутов (решение 117): кто считается
 * субъектом, какие маршруты свободны, какие заголовки уходят, что пишется
 * в журнал. Сессия и журнал подменены: база и NextAuth тут не нужны.
 */

const session = vi.hoisted(() => ({ current: null as { user: { id: string; email: string } } | null }))
const audit = vi.hoisted(() => ({ writeAudit: vi.fn(async (_entry: unknown) => undefined) }))

vi.mock('@/shared/auth/auth', () => ({ auth: async () => session.current }))
vi.mock('@/shared/audit/audit', () => audit)

const { handle, ok } = await import('@/shared/http')
const { consumeRateLimit, resetRateLimit, withRateLimit } = await import('./rate-limit-guard')

const route = handle(async () => ok({ fine: true }))

function request(path: string, init: { method?: string; ip?: string; headers?: Record<string, string> } = {}): Request {
  return new Request(`http://localhost${path}`, {
    method: init.method ?? 'GET',
    headers: { 'x-forwarded-for': init.ip ?? '203.0.113.10', ...init.headers },
  })
}

async function hammer(path: string, times: number, init?: Parameters<typeof request>[1]): Promise<Response[]> {
  const responses: Response[] = []
  for (let index = 0; index < times; index += 1) responses.push(await route(request(path, init), {}))
  return responses
}

beforeEach(() => {
  // Вне демо-режима — как на стенде: там общий счёт отказывает по-настоящему.
  vi.stubEnv('DEMO_AUTH_ENABLED', 'false')
  resetRateLimit()
  session.current = null
  audit.writeAudit.mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('заголовки и ответ 429', () => {
  it('ответ маршрута несёт RateLimit-*', async () => {
    const response = await route(request('/api/universities'), {})
    expect(response.status).toBe(200)
    expect(response.headers.get('RateLimit-Limit')).toBe(String(RATE_LIMITS.read))
    expect(response.headers.get('RateLimit-Remaining')).toBe(String(RATE_LIMITS.read - 1))
    expect(Number(response.headers.get('RateLimit-Reset'))).toBeGreaterThanOrEqual(1)
    expect(response.headers.get('Retry-After')).toBeNull()
  })

  it('ошибка маршрута тоже несёт заголовки', async () => {
    const failing = handle(async () => {
      throw new Error('сбой')
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await failing(request('/api/universities'), {})
    expect(response.status).toBe(500)
    expect(response.headers.get('RateLimit-Limit')).toBe(String(RATE_LIMITS.read))
  })

  it('сверх предела — 429 в формате ошибок контракта, с Retry-After, обработчик не вызывается', async () => {
    const inner = vi.fn(async () => ok({}))
    const counted = handle(inner)
    const limit = RATE_LIMITS.heavy
    for (let index = 0; index < limit; index += 1) await counted(request('/api/export'), {})
    const rejected = await counted(request('/api/export'), {})

    expect(inner).toHaveBeenCalledTimes(limit)
    expect(rejected.status).toBe(429)
    const retryAfter = Number(rejected.headers.get('Retry-After'))
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    expect(retryAfter).toBeLessThanOrEqual(60)
    expect(rejected.headers.get('RateLimit-Remaining')).toBe('0')
    const body = (await rejected.json()) as { error: { code: string; message: string; details: unknown } }
    expect(body.error.code).toBe('RATE_LIMITED')
    expect(body.error.message).toContain(`${retryAfter} с`)
    expect(body.error.details).toEqual({ retryAfterSeconds: retryAfter })
  })

  it('отказ входу через signIn несёт url с code=rate_limited — экран входа его разберёт', async () => {
    const login = withRateLimit(async () => new Response('{}'))
    const init = { method: 'POST', headers: { 'x-auth-return-redirect': '1' } }
    for (let index = 0; index < RATE_LIMITS.auth; index += 1) {
      await login(request('/api/auth/callback/credentials', init))
    }
    const rejected = await login(request('/api/auth/callback/credentials', init))
    expect(rejected.status).toBe(429)
    const body = (await rejected.json()) as { url: string; error: { code: string } }
    expect(body.error.code).toBe('RATE_LIMITED')
    const url = new URL(body.url)
    expect(url.pathname).toBe('/login')
    expect(url.searchParams.get('code')).toBe('rate_limited')
    expect(url.searchParams.get('error')).toBe('CredentialsSignin')
  })

  it('заголовки ставятся и на ответ с неизменяемыми заголовками', async () => {
    const redirecting = withRateLimit(async () => Response.redirect('http://localhost/login', 302))
    const response = await redirecting(request('/api/auth/signout', { method: 'POST' }))
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('http://localhost/login')
    expect(response.headers.get('RateLimit-Limit')).toBe(String(RATE_LIMITS.auth))
  })
})

describe('исключения', () => {
  it('проверка живости и вебхук Telegram не ограничиваются и заголовков не несут', async () => {
    for (const [path, method] of [
      ['/api/health', 'GET'],
      ['/api/telegram/webhook', 'POST'],
    ] as const) {
      const responses = await hammer(path, RATE_LIMITS.read + 5, { method })
      expect(responses.every((response) => response.status === 200)).toBe(true)
      expect(responses[0]!.headers.get('RateLimit-Limit')).toBeNull()
    }
  })
})

describe('субъект', () => {
  it('без сессии — адрес клиента; другой адрес — свой счёт', async () => {
    const first = await hammer('/api/export', RATE_LIMITS.heavy + 1, { ip: '198.51.100.1' })
    expect(first.at(-1)!.status).toBe(429)
    const other = await route(request('/api/export', { ip: '198.51.100.2' }), {})
    expect(other.status).toBe(200)
  })

  it('подделанный первый адрес X-Forwarded-For счётчик не меняет', async () => {
    for (let index = 0; index < RATE_LIMITS.heavy; index += 1) {
      await route(request('/api/export', { ip: `10.0.0.${index}, 198.51.100.7` }), {})
    }
    const rejected = await route(request('/api/export', { ip: '9.9.9.9, 198.51.100.7' }), {})
    expect(rejected.status).toBe(429)
  })

  it('IPv6 из одной сети /48 — один счёт', async () => {
    for (let index = 0; index < RATE_LIMITS.heavy; index += 1) {
      await route(request('/api/export', { ip: `2001:db8:1:${index.toString(16)}::1` }), {})
    }
    const rejected = await route(request('/api/export', { ip: '2001:db8:1:ffff::abcd' }), {})
    expect(rejected.status).toBe(429)
  })

  it('с сессией — пользователь, с какого бы адреса он ни пришёл', async () => {
    session.current = { user: { id: 'user-1', email: 'person@example.ru' } }
    for (let index = 0; index < RATE_LIMITS.heavy; index += 1) {
      await route(request('/api/export', { ip: `198.51.100.${index}` }), {})
    }
    const rejected = await route(request('/api/export', { ip: '192.0.2.200' }), {})
    expect(rejected.status).toBe(429)
    // Другой пользователь с того же адреса не задет.
    session.current = { user: { id: 'user-2', email: 'other@example.ru' } }
    expect((await route(request('/api/export', { ip: '192.0.2.200' }), {})).status).toBe(200)
  })

  it('общая демо-учётка стенда: у каждого адреса свой счёт', async () => {
    session.current = { user: { id: 'demo-manager', email: 'manager@skilllink.demo' } }
    const first = await hammer('/api/export', RATE_LIMITS.heavy + 1, { ip: '198.51.100.1' })
    expect(first.at(-1)!.status).toBe(429)
    expect((await route(request('/api/export', { ip: '198.51.100.2' }), {})).status).toBe(200)
  })

  it('вход считается по адресу даже с сессией', async () => {
    session.current = { user: { id: 'user-1', email: 'person@example.ru' } }
    const verdict = await consumeRateLimit(request('/api/login-challenge'))
    expect(verdict?.group).toBe('auth')
    expect(verdict?.subject).toEqual({ kind: 'address', key: 'ip:203.0.113.10', userId: null })
  })

  it('лента календаря — по хешу токена, сам токен в ключ не попадает', async () => {
    const token = 'secret-feed-token-value'
    const verdict = await consumeRateLimit(request(`/api/calendar/${token}.ics`))
    expect(verdict?.group).toBe('feed')
    expect(verdict?.subject.kind).toBe('feed')
    expect(verdict?.subject.key).not.toContain(token)
    // Разные адреса одной ленты — один счёт.
    const again = await consumeRateLimit(request(`/api/calendar/${token}.ics`, { ip: '192.0.2.1' }))
    expect(again?.subject.key).toBe(verdict?.subject.key)
    expect(again?.decision.remaining).toBe(RATE_LIMITS.feed - 2)
  })

  it('демо-cookie субъектом не считается: сменой значения счёт не обнулить', async () => {
    const one = await consumeRateLimit(request('/api/universities', { headers: { cookie: 'skilllink_user=a' } }))
    const two = await consumeRateLimit(request('/api/universities', { headers: { cookie: 'skilllink_user=b' } }))
    expect(one?.subject.key).toBe(two?.subject.key)
  })

  it('чтение и запись считаются отдельно', async () => {
    const read = await consumeRateLimit(request('/api/universities'))
    const write = await consumeRateLimit(request('/api/universities', { method: 'POST' }))
    expect(read?.decision.remaining).toBe(RATE_LIMITS.read - 1)
    expect(write?.decision.remaining).toBe(RATE_LIMITS.write - 1)
  })
})

describe('журнал действий', () => {
  it('одна запись на первое превышение в минуте, без адреса и пути', async () => {
    session.current = { user: { id: 'user-1', email: 'person@example.ru' } }
    await hammer('/api/export', RATE_LIMITS.heavy + 5)
    expect(audit.writeAudit).toHaveBeenCalledTimes(1)
    const entry = audit.writeAudit.mock.calls[0]![0] as unknown as Record<string, unknown>
    expect(entry).toMatchObject({
      userId: 'user-1',
      action: 'api.rate-limit.exceeded',
      objectType: 'User',
      objectId: 'user-1',
      payload: { group: 'heavy', limit: RATE_LIMITS.heavy, subject: 'user' },
    })
    expect(JSON.stringify(entry)).not.toContain('203.0.113.10')
    expect(JSON.stringify(entry)).not.toContain('/api/export')
  })

  it('без сессии — без пользователя', async () => {
    await hammer('/api/export', RATE_LIMITS.heavy + 1)
    expect(audit.writeAudit.mock.calls[0]![0]).toMatchObject({ userId: null, objectId: 'unknown' })
  })
})

describe('сбой ограничителя', () => {
  it('запрос пропускается, в журнал сервера — предупреждение', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const broken = { method: 'GET', url: 'не адрес', headers: new Headers() } as unknown as Request
    expect(await consumeRateLimit(broken)).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('демо-режим', () => {
  it('общий счёт только считает: заголовки есть, 429 нет, журнал молчит', async () => {
    vi.stubEnv('DEMO_AUTH_ENABLED', 'true')
    const responses = await hammer('/api/export', RATE_LIMITS.heavy + 3)
    expect(responses.every((response) => response.status === 200)).toBe(true)
    const last = responses.at(-1)!
    expect(last.headers.get('RateLimit-Limit')).toBe(String(RATE_LIMITS.heavy))
    expect(last.headers.get('RateLimit-Remaining')).toBe('0')
    expect(last.headers.get('Retry-After')).toBeNull()
    expect(audit.writeAudit).not.toHaveBeenCalled()
  })
})

describe('низкий предел для пробника', () => {
  it('в демо-режиме заголовок пробника получает свой счёт с пределом из RATE_LIMIT_TEST_OVERRIDE', async () => {
    vi.stubEnv('DEMO_AUTH_ENABLED', 'true')
    vi.stubEnv('RATE_LIMIT_TEST_OVERRIDE', '3')
    const init = { headers: { 'x-rate-limit-test': 'probe-1' } }
    const responses = await hammer('/api/universities', 4, init)
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 429])
    expect(responses[0]!.headers.get('RateLimit-Limit')).toBe('3')
    // Обычный счёт того же адреса не исчерпан.
    expect((await route(request('/api/universities'), {})).status).toBe(200)
  })

  it('без демо-режима заголовок ничего не меняет', async () => {
    vi.stubEnv('DEMO_AUTH_ENABLED', 'false')
    vi.stubEnv('RATE_LIMIT_TEST_OVERRIDE', '3')
    const responses = await hammer('/api/universities', 4, { headers: { 'x-rate-limit-test': 'probe-1' } })
    expect(responses.every((response) => response.status === 200)).toBe(true)
    expect(responses[0]!.headers.get('RateLimit-Limit')).toBe(String(RATE_LIMITS.read))
  })
})
