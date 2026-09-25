import { describe, expect, it } from 'vitest'
import { buildContentSecurityPolicy, createNonce } from './csp'

/** Директивы политики словарём: имя → значения. */
function parse(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(';').map((part) => {
      const [name, ...values] = part.trim().split(/\s+/)
      return [name!, values]
    }),
  )
}

describe('Content-Security-Policy (решение 112)', () => {
  const prod = parse(buildContentSecurityPolicy({ nonce: 'abc123==', dev: false, https: true }))

  it('скрипты — только по nonce и по цепочке от них', () => {
    expect(prod.get('script-src')).toEqual(["'nonce-abc123=='", "'strict-dynamic'"])
  })

  it('в боевой политике нет unsafe-eval и unsafe-inline для скриптов', () => {
    const policy = buildContentSecurityPolicy({ nonce: 'abc123==', dev: false, https: false })
    expect(policy).not.toContain('unsafe-eval')
    expect(parse(policy).get('script-src')).not.toContain("'unsafe-inline'")
  })

  it('разработке разрешён eval — без него next dev не оживает', () => {
    const dev = parse(buildContentSecurityPolicy({ nonce: 'n', dev: true, https: false }))
    expect(dev.get('script-src')).toContain("'unsafe-eval'")
    expect(dev.has('upgrade-insecure-requests')).toBe(false)
  })

  it('остальные директивы — как в решении', () => {
    expect(prod.get('default-src')).toEqual(["'self'"])
    expect(prod.get('style-src')).toEqual(["'self'", "'unsafe-inline'"])
    expect(prod.get('img-src')).toEqual(["'self'", 'data:', 'blob:'])
    expect(prod.get('font-src')).toEqual(["'self'"])
    expect(prod.get('connect-src')).toEqual(["'self'"])
    expect(prod.get('worker-src')).toEqual(["'self'", 'blob:'])
    expect(prod.get('frame-ancestors')).toEqual(["'none'"])
    expect(prod.get('object-src')).toEqual(["'none'"])
    expect(prod.get('base-uri')).toEqual(["'self'"])
    expect(prod.get('form-action')).toEqual(["'self'"])
  })

  it('upgrade-insecure-requests — только в боевой сборке за HTTPS', () => {
    expect(prod.has('upgrade-insecure-requests')).toBe(true)
    // Стенд без домена и запасной ноутбук работают по http: подъём до https их сломал бы.
    expect(buildContentSecurityPolicy({ nonce: 'n', dev: false, https: false })).not.toContain('upgrade-insecure-requests')
  })

  it('nonce — 16 случайных байт в base64, в формате, который Next находит в политике', () => {
    const nonce = createNonce()
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/)
    // То же выражение, которым Next достаёт nonce из заголовка (get-script-nonce-from-header).
    expect(`'nonce-${nonce}'`).toMatch(/^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/)
    expect(createNonce()).not.toBe(nonce)
  })
})
