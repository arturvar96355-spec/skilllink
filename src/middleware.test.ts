import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from './middleware'

function request(path: string, withSession: boolean): NextRequest {
  const req = new NextRequest(`https://skilllink.test${path}`)
  if (withSession) req.cookies.set('authjs.session-token', 'x')
  return req
}

const redirectTarget = (res: Response) => res.headers.get('location')

describe('middleware', () => {
  it('без сессии страницы системы уводят на вход', () => {
    expect(redirectTarget(middleware(request('/cooperations', false)))).toBe(
      'https://skilllink.test/login?from=%2Fcooperations',
    )
  })

  it('презентация открыта без сессии — вместе с её файлами', () => {
    expect(redirectTarget(middleware(request('/presentation', false)))).toBeNull()
    expect(redirectTarget(middleware(request('/presentation/scene.glb', false)))).toBeNull()
  })

  it('презентация открыта и с сессией: на главную не уводит', () => {
    expect(redirectTarget(middleware(request('/presentation', true)))).toBeNull()
  })

  it('политика обработки персональных данных открыта без сессии', () => {
    expect(redirectTarget(middleware(request('/privacy', false)))).toBeNull()
  })

  it('политика открыта и с сессией: на главную не уводит', () => {
    expect(redirectTarget(middleware(request('/privacy', true)))).toBeNull()
  })

  it('манифест со значками браузер получает без входа', () => {
    expect(redirectTarget(middleware(request('/manifest.webmanifest', false)))).toBeNull()
  })

  it('похожий на политику адрес не открывается', () => {
    expect(redirectTarget(middleware(request('/privacy-admin', false)))).toContain('/login')
  })

  it('похожий адрес не открывается', () => {
    expect(redirectTarget(middleware(request('/presentations-secret', false)))).toContain('/login')
  })

  it('вошедшего со страницы входа уводит на главную', () => {
    expect(redirectTarget(middleware(request('/login', true)))).toBe('https://skilllink.test/')
  })
})

describe('middleware: Content-Security-Policy с nonce (решение 112)', () => {
  const nonceOf = (policy: string | null) => policy?.match(/script-src 'nonce-([^']+)'/)?.[1]

  afterEach(() => vi.unstubAllEnvs())

  it('страница получает политику со скриптами только по nonce и strict-dynamic', () => {
    const policy = middleware(request('/cooperations', true)).headers.get('content-security-policy')
    expect(policy).toMatch(/script-src 'nonce-[A-Za-z0-9+/]+={0,2}' 'strict-dynamic'/)
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("frame-ancestors 'none'")
  })

  it('nonce у каждого запроса свой', () => {
    const nonces = new Set(
      Array.from({ length: 20 }, () =>
        nonceOf(middleware(request('/cooperations', true)).headers.get('content-security-policy')),
      ),
    )
    expect(nonces.size).toBe(20)
  })

  it('nonce и политика уходят в заголовки запроса к Next — тот же nonce, что в ответе', () => {
    const response = middleware(request('/cooperations', true))
    const policy = response.headers.get('content-security-policy')
    // Так NextResponse.next({ request: { headers } }) передаёт заголовки дальше.
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonceOf(policy))
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(policy)
  })

  it('nonce, присланный клиентом, заменяется своим', () => {
    const req = request('/cooperations', true)
    req.headers.set('x-nonce', 'attacker')
    const response = middleware(req)
    expect(response.headers.get('x-middleware-request-x-nonce')).not.toBe('attacker')
  })

  it('открытые страницы и вход тоже под политикой', () => {
    for (const path of ['/privacy', '/presentation', '/login']) {
      expect(middleware(request(path, false)).headers.get('content-security-policy')).toContain("'strict-dynamic'")
    }
  })

  it('в боевой сборке политика без unsafe-eval', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const policy = middleware(request('/cooperations', true)).headers.get('content-security-policy')
    expect(policy).not.toContain('unsafe-eval')
    expect(policy).not.toContain("'unsafe-inline' 'strict-dynamic'")
  })

  it('upgrade-insecure-requests — только в боевой сборке и только за HTTPS', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const plain = middleware(request('/cooperations', true))
    expect(plain.headers.get('content-security-policy')).toContain('upgrade-insecure-requests')

    const req = new NextRequest('http://10.0.0.5/cooperations')
    req.cookies.set('authjs.session-token', 'x')
    expect(middleware(req).headers.get('content-security-policy')).not.toContain('upgrade-insecure-requests')

    const proxied = new NextRequest('http://app:3000/cooperations', { headers: { 'x-forwarded-proto': 'https' } })
    proxied.cookies.set('authjs.session-token', 'x')
    expect(middleware(proxied).headers.get('content-security-policy')).toContain('upgrade-insecure-requests')
  })
})
