import { afterEach, describe, expect, it } from 'vitest'
import { POST } from '@/app/api/client-errors/route'
import { captureLog } from './logger'
import { CLIENT_ERRORS, ClientErrorLimiter, sanitizeClientError, stripQuery } from './client-errors'

describe('ошибки фронтенда (решение 133)', () => {
  let restore: () => void = () => {}
  afterEach(() => restore())

  it('известные поля обрезаются, остальные отбрасываются', () => {
    const report = sanitizeClientError({ message: 'x'.repeat(5000), stack: 'at a', cookie: 'secret', url: 'https://a/b' })
    expect(report?.message?.length).toBe(CLIENT_ERRORS.fieldLimits.message + 1)
    expect(report).not.toHaveProperty('cookie')
    expect(sanitizeClientError({ url: 'x' })).toBeNull()
    expect(sanitizeClientError('строка')).toBeNull()
    expect(stripQuery('https://s.test/universities?q=Иванов#x')).toBe('https://s.test/universities')
  })

  it('частота по адресу: не больше N в минуту, новое окно — снова можно', () => {
    const limiter = new ClientErrorLimiter({ ...CLIENT_ERRORS, perAddress: 3 })
    const results = Array.from({ length: 5 }, () => limiter.allow('1.1.1.1', 1000))
    expect(results).toEqual([true, true, true, false, false])
    expect(limiter.allow('2.2.2.2', 1000)).toBe(true)
    expect(limiter.allow('1.1.1.1', 1000 + 60_000)).toBe(true)
  })

  it('маршрут: 204 всегда; в журнал — метка, номер запроса, без токенов и почты', async () => {
    const lines: string[] = []
    restore = captureLog((_level, line) => lines.push(line))
    const send = (body: string, headers: Record<string, string> = {}) =>
      POST(new Request('http://localhost/api/client-errors', { method: 'POST', headers: { 'x-forwarded-for': '10.0.0.1', ...headers }, body }))

    const ok = await send(
      JSON.stringify({ message: 'Ошибка у ivan@univ.ru', stack: 'at render', url: 'https://s.test/x?token=abc' }),
      { 'x-request-id': 'front-1' },
    )
    const garbage = await send('не json')
    const huge = await send(JSON.stringify({ message: 'x'.repeat(10_000) }))
    const foreign = await send(JSON.stringify({ message: 'чужой' }), { origin: 'https://evil.example', host: 'localhost' })

    expect([ok.status, garbage.status, huge.status, foreign.status]).toEqual([204, 204, 204, 204])
    expect(ok.headers.get('x-request-id')).toBe('front-1')
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(entry).toMatchObject({ level: 'warn', msg: 'client-error', kind: 'client-error', requestId: 'front-1', url: 'https://s.test/x' })
    expect(lines[0]).not.toContain('ivan@univ.ru')
    expect(lines[0]).toContain('i***@univ.ru')
  })

  it('маршрут: сверх предела с одного адреса — 204 без записи', async () => {
    const lines: string[] = []
    restore = captureLog((_level, line) => lines.push(line))
    const body = JSON.stringify({ message: 'повтор' })
    const statuses = []
    for (let i = 0; i < CLIENT_ERRORS.perAddress + 5; i += 1) {
      statuses.push((await POST(new Request('http://localhost/api/client-errors', { method: 'POST', headers: { 'x-forwarded-for': '10.9.9.9' }, body }))).status)
    }
    expect(new Set(statuses)).toEqual(new Set([204]))
    expect(lines).toHaveLength(CLIENT_ERRORS.perAddress)
  })
})
