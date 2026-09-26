import { describe, expect, it } from 'vitest'
import { isLoopback, metricsAccess } from './access'

/**
 * Доступ к метрикам (решение 137): токен или петлевой адрес. Здесь — только
 * решение (`allowed` / `unauthorized` / `disabled`); что маршрут отвечает на
 * каждое — route.test.ts.
 */

function request(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/metrics', { headers })
}

describe('isLoopback', () => {
  it('петлевой адрес — последнее значение X-Forwarded-For', () => {
    expect(isLoopback(request({ 'x-forwarded-for': '127.0.0.1' }).headers)).toBe(true)
    expect(isLoopback(request({ 'x-forwarded-for': '::1' }).headers)).toBe(true)
    expect(isLoopback(request({ 'x-forwarded-for': '203.0.113.5, 127.0.0.1' }).headers)).toBe(true)
  })

  it('чужой адрес и отсутствие заголовка — не петлевой', () => {
    expect(isLoopback(request({ 'x-forwarded-for': '203.0.113.5' }).headers)).toBe(false)
    expect(isLoopback(request().headers)).toBe(false)
  })

  it('отображённый IPv4 в IPv6 — тоже петлевой', () => {
    expect(isLoopback(request({ 'x-forwarded-for': '::ffff:127.0.0.1' }).headers)).toBe(true)
  })
})

describe('metricsAccess', () => {
  it('токен не задан, адрес чужой — как будто маршрута нет', () => {
    const result = metricsAccess(request({ 'x-forwarded-for': '203.0.113.5' }), undefined)
    expect(result).toBe('disabled')
  })

  it('токен не задан, адрес петлевой — доступ есть без токена', () => {
    const result = metricsAccess(request({ 'x-forwarded-for': '127.0.0.1' }), undefined)
    expect(result).toBe('allowed')
  })

  it('токен задан, не предъявлен — неавторизован (не «как будто нет»)', () => {
    const result = metricsAccess(request({ 'x-forwarded-for': '203.0.113.5' }), 'secret')
    expect(result).toBe('unauthorized')
  })

  it('токен задан неверно', () => {
    const result = metricsAccess(
      request({ 'x-forwarded-for': '203.0.113.5', authorization: 'Bearer wrong' }),
      'secret',
    )
    expect(result).toBe('unauthorized')
  })

  it('токен задан и верен', () => {
    const result = metricsAccess(
      request({ 'x-forwarded-for': '203.0.113.5', authorization: 'Bearer secret' }),
      'secret',
    )
    expect(result).toBe('allowed')
  })

  it('заголовок Authorization без Bearer или без токена — неавторизован', () => {
    expect(metricsAccess(request({ authorization: 'Basic xyz' }), 'secret')).toBe('unauthorized')
    expect(metricsAccess(request({ authorization: 'Bearer' }), 'secret')).toBe('unauthorized')
  })

  it('петлевой адрес перекрывает даже неверный токен', () => {
    const result = metricsAccess(
      request({ 'x-forwarded-for': '127.0.0.1', authorization: 'Bearer wrong' }),
      'secret',
    )
    expect(result).toBe('allowed')
  })
})
