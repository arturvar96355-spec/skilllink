import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PROMETHEUS_CONTENT_TYPE } from '@/shared/metrics/registry'
import { GET } from './route'

/**
 * Маршрут целиком (решение 137): доступ определяет ответ, а не только решение
 * metricsAccess (это — access.test.ts). GET — безопасный метод, поэтому не
 * трогает ни ограничение частоты (маршрут в RATE_LIMIT_EXEMPT_PATHS, а группа
 * для него и так null), ни проверку Origin (только изменяющие запросы).
 */

function request(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/metrics', { headers })
}

describe('GET /api/metrics', () => {
  const original = process.env.METRICS_TOKEN

  beforeEach(() => {
    delete process.env.METRICS_TOKEN
  })

  afterEach(() => {
    if (original === undefined) delete process.env.METRICS_TOKEN
    else process.env.METRICS_TOKEN = original
  })

  it('токен не задан, адрес чужой — 404: как будто маршрута нет', async () => {
    const response = await GET(request({ 'x-forwarded-for': '203.0.113.5' }), undefined as never)
    expect(response.status).toBe(404)
  })

  it('токен задан, не предъявлен — 401', async () => {
    process.env.METRICS_TOKEN = 'test-secret'
    const response = await GET(request({ 'x-forwarded-for': '203.0.113.5' }), undefined as never)
    expect(response.status).toBe(401)
  })

  it('токен задан и верен — 200, текст в формате Prometheus', async () => {
    process.env.METRICS_TOKEN = 'test-secret'
    const response = await GET(
      request({ 'x-forwarded-for': '203.0.113.5', authorization: 'Bearer test-secret' }),
      undefined as never,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(PROMETHEUS_CONTENT_TYPE)
    expect(response.headers.get('cache-control')).toBe('no-store')

    const body = await response.text()
    expect(body).toContain('# TYPE http_requests_total counter')
    expect(body).toContain('# TYPE http_request_duration_seconds histogram')
    expect(body).toContain('# TYPE app_build_info gauge')
    expect(body).toContain('# TYPE db_up gauge')
  })

  it('петлевой адрес — 200 без токена', async () => {
    const response = await GET(request({ 'x-forwarded-for': '127.0.0.1' }), undefined as never)
    expect(response.status).toBe(200)
  })

  it('сам себя не считает: повторный запрос не добавляет строку route="/api/metrics"', async () => {
    process.env.METRICS_TOKEN = 'test-secret'
    const authorized = { 'x-forwarded-for': '203.0.113.5', authorization: 'Bearer test-secret' }
    await GET(request(authorized), undefined as never)
    const response = await GET(request(authorized), undefined as never)
    const body = await response.text()
    expect(body).not.toContain('route="/api/metrics"')
  })
})
