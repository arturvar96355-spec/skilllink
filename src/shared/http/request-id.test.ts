import { afterEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '@/middleware'
import { captureLog } from '@/shared/log/logger'
import { handle } from './handle'
import { notFound } from './errors'
import { isValidRequestId, resolveRequestId } from './request-id'

describe('номер запроса x-request-id (решение 133)', () => {
  it('допустимый входящий принимается, недопустимый заменяется своим', () => {
    expect(resolveRequestId('abc-123')).toBe('abc-123')
    expect(isValidRequestId('a'.repeat(64))).toBe(true)
    for (const bad of ['a'.repeat(65), 'a b', 'a\nb', '<script>', 'id_1', '', null, undefined]) {
      const resolved = resolveRequestId(bad)
      expect(resolved).not.toBe(bad)
      expect(isValidRequestId(resolved)).toBe(true)
    }
  })

  it('middleware: API получает номер в заголовке запроса и ответа, без перенаправления на вход', () => {
    const response = middleware(new NextRequest('https://skilllink.test/api/universities'))
    const id = response.headers.get('x-request-id')
    expect(isValidRequestId(id)).toBe(true)
    expect(response.headers.get('location')).toBeNull()
    // Номер уходит обработчику: Next передаёт изменённые заголовки запроса так.
    expect(response.headers.get('x-middleware-request-x-request-id')).toBe(id)
    // У API политика с nonce не выдаётся — у него общая часть из next.config.ts.
    expect(response.headers.get('content-security-policy')).toBeNull()
  })

  it('middleware: присланный допустимый номер сохраняется, мусорный — заменяется', () => {
    const kept = middleware(new NextRequest('https://skilllink.test/api/me', { headers: { 'x-request-id': 'from-proxy-1' } }))
    expect(kept.headers.get('x-request-id')).toBe('from-proxy-1')
    const replaced = middleware(new NextRequest('https://skilllink.test/api/me', { headers: { 'x-request-id': 'bad id\n' } }))
    expect(replaced.headers.get('x-request-id')).not.toBe('bad id\n')
  })

  it('middleware: страница и перенаправление на вход тоже несут номер', () => {
    expect(isValidRequestId(middleware(new NextRequest('https://skilllink.test/cooperations')).headers.get('x-request-id'))).toBe(true)
  })
})

describe('handle(): 500 с номером запроса, без внутренностей', () => {
  let restore: (() => void) | null = null
  afterEach(() => restore?.())

  it('внутренняя ошибка: requestId в теле и заголовке, в журнале — та же строка без секрета', async () => {
    const lines: string[] = []
    restore = captureLog((_level, line) => lines.push(line))
    const route = handle(async () => {
      throw new Error('упало на 123456789:AAHfakeTokenForTests_abcdefghijklmnopq')
    })
    const response = await route(new Request('http://localhost/api/x', { headers: { 'x-request-id': 'req-500' } }), {})
    const body = (await response.json()) as { error: { code: string; message: string; requestId: string } }

    expect(response.status).toBe(500)
    expect(body.error).toEqual({ code: 'INTERNAL', message: 'Внутренняя ошибка сервера', requestId: 'req-500' })
    expect(response.headers.get('x-request-id')).toBe('req-500')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 'error', requestId: 'req-500', path: '/api/x' })
    expect(lines[0]).not.toContain('AAHfakeToken')
  })

  it('известная ошибка — прежний формат, номер только в заголовке', async () => {
    const route = handle(async () => {
      throw notFound()
    })
    const response = await route(new Request('http://localhost/api/x'), {})
    const body = (await response.json()) as { error: Record<string, unknown> }
    expect(response.status).toBe(404)
    expect(body.error.requestId).toBeUndefined()
    expect(isValidRequestId(response.headers.get('x-request-id'))).toBe(true)
  })
})
