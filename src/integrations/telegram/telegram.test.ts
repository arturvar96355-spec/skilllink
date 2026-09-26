import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getIntegrationsConfig, TELEGRAM_DEFAULT_API_BASE, type TelegramConfig } from '../config'
import { createHttpsTransport, type HttpsPostRequest, type HttpsTransport } from '../https-transport'
import { TelegramClient, TELEGRAM_MAX_TEXT } from './telegram.client'

/**
 * Клиент Bot API (решение 102). Сети здесь нет: транспорт и `https.request`
 * подменены — проверяется, что уходит наружу, как читается ответ и что токен
 * не попадает в журнал.
 */

const TOKEN = '123456:SECRET-token'

function config(overrides: Partial<TelegramConfig> = {}): TelegramConfig {
  return {
    botToken: TOKEN,
    botUsername: 'skilllink_bot',
    webhookSecret: 'hook-secret',
    apiBase: TELEGRAM_DEFAULT_API_BASE,
    apiIp: null,
    timeoutMs: 1000,
    enabled: true,
    ...overrides,
  }
}

/** Транспорт по сценарию: ответ на каждую попытку, исключение — сбой сети. */
function scripted(replies: Array<{ status: number; body: string } | Error>) {
  const calls: HttpsPostRequest[] = []
  const transport: HttpsTransport = async (request) => {
    calls.push(request)
    const reply = replies[calls.length - 1] ?? replies.at(-1)!
    if (reply instanceof Error) throw reply
    return reply
  }
  return { transport, calls }
}

const noWait = async () => {}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  warn.mockRestore()
})

describe('sendMessage', () => {
  it('шлёт POST на /bot<токен>/sendMessage с chat_id и текстом, без предпросмотра ссылок', async () => {
    const { transport, calls } = scripted([{ status: 200, body: '{"ok":true,"result":{}}' }])
    const result = await new TelegramClient(config(), { transport, wait: noWait }).sendMessage('42', 'Привет')

    expect(result).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`)
    expect(JSON.parse(calls[0]!.body)).toEqual({
      chat_id: '42',
      text: 'Привет',
      link_preview_options: { is_disabled: true },
    })
    expect(calls[0]!.connectAddress).toBeNull()
  })

  it('без токена ничего не отправляет', async () => {
    const { transport, calls } = scripted([{ status: 200, body: '{"ok":true}' }])
    const client = new TelegramClient(config({ botToken: null, enabled: false }), { transport, wait: noWait })
    expect(client.enabled).toBe(false)
    expect(await client.sendMessage('42', 'x')).toEqual({ ok: false, reason: 'disabled', status: null })
    expect(calls).toHaveLength(0)
  })

  it('сетевой сбой — одна повторная попытка, и она спасает', async () => {
    const { transport, calls } = scripted([new Error('Таймаут запроса: 1000 мс'), { status: 200, body: '{"ok":true}' }])
    const result = await new TelegramClient(config(), { transport, wait: noWait }).sendMessage('42', 'x')
    expect(result).toEqual({ ok: true })
    expect(calls).toHaveLength(2)
  })

  it('две неудачи — failed, третьей попытки нет, исключения наружу нет', async () => {
    const { transport, calls } = scripted([{ status: 502, body: 'Bad Gateway' }])
    const result = await new TelegramClient(config(), { transport, wait: noWait }).sendMessage('42', 'x')
    expect(result).toEqual({ ok: false, reason: 'failed', status: 502 })
    expect(calls).toHaveLength(2)
  })

  it('429 — ждёт, сколько просит Telegram, но не больше пяти секунд', async () => {
    const waits: number[] = []
    const { transport } = scripted([
      { status: 429, body: '{"ok":false,"error_code":429,"parameters":{"retry_after":60}}' },
      { status: 200, body: '{"ok":true}' },
    ])
    const client = new TelegramClient(config(), { transport, wait: async (ms) => void waits.push(ms) })
    expect(await client.sendMessage('42', 'x')).toEqual({ ok: true })
    expect(waits).toEqual([5000])
  })

  it('403 (бот остановлен) — blocked и без повтора', async () => {
    const { transport, calls } = scripted([
      { status: 403, body: '{"ok":false,"error_code":403,"description":"Forbidden: bot was blocked by the user"}' },
    ])
    const result = await new TelegramClient(config(), { transport, wait: noWait }).sendMessage('42', 'x')
    expect(result).toEqual({ ok: false, reason: 'blocked', status: 403 })
    expect(calls).toHaveLength(1)
  })

  it('400 не повторяется', async () => {
    const { transport, calls } = scripted([{ status: 400, body: '{"ok":false,"error_code":400}' }])
    const result = await new TelegramClient(config(), { transport, wait: noWait }).sendMessage('42', 'x')
    expect(result).toEqual({ ok: false, reason: 'failed', status: 400 })
    expect(calls).toHaveLength(1)
  })

  it('токен не попадает в журнал, даже если он есть в тексте ошибки', async () => {
    const { transport } = scripted([new Error(`connect ECONNREFUSED /bot${TOKEN}/sendMessage`)])
    await new TelegramClient(config(), { transport, wait: noWait }).sendMessage('42', 'секретный текст')
    // Строки журнала — JSON (решение 123); время в них может содержать «42», его не смотрим.
    const logged = warn.mock.calls
      .flat()
      .map((line: unknown) => String(line).replace(/"ts":"[^"]*"/, ''))
      .join('\n')
    expect(logged).not.toContain(TOKEN)
    expect(logged).not.toContain('секретный текст')
    expect(logged).not.toContain('42')
    expect(logged).toContain('[токен скрыт]')
  })

  it('setWebhook: секрет только в теле запроса к Telegram — не в журнале и не в результате', async () => {
    const secret = 'NewSecret_0123456789abcdefghijklmnopqrstuvw'
    const ok = scripted([{ status: 200, body: '{"ok":true,"result":true}' }])
    expect(await new TelegramClient(config(), { transport: ok.transport, wait: noWait }).setWebhook('https://x.test/api/telegram/webhook', secret)).toEqual({ ok: true })
    expect(ok.calls[0]!.url).toBe(`https://api.telegram.org/bot${TOKEN}/setWebhook`)
    expect(JSON.parse(ok.calls[0]!.body)).toEqual({ url: 'https://x.test/api/telegram/webhook', secret_token: secret })

    const rejected = scripted([{ status: 400, body: `{"ok":false,"description":"Bad Request: bad webhook ${secret}"}` }])
    const result = await new TelegramClient(config(), { transport: rejected.transport, wait: noWait }).setWebhook('https://x', secret)
    expect(result).toMatchObject({ ok: false, reason: 'failed', status: 400 })
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(warn.mock.calls.flat().join('\n')).not.toContain(secret)
    expect(rejected.calls).toHaveLength(1)
  })

  it('текст длиннее предела Bot API обрезается, а не отвергается', async () => {
    const { transport, calls } = scripted([{ status: 200, body: '{"ok":true}' }])
    await new TelegramClient(config(), { transport, wait: noWait }).sendMessage('42', 'я'.repeat(5000))
    const sent = JSON.parse(calls[0]!.body) as { text: string }
    expect(sent.text).toHaveLength(TELEGRAM_MAX_TEXT)
    expect(sent.text.endsWith('…')).toBe(true)
  })

  it('TELEGRAM_API_IP уходит в транспорт как адрес подключения', async () => {
    const { transport, calls } = scripted([{ status: 200, body: '{"ok":true}' }])
    await new TelegramClient(config({ apiIp: '149.154.167.220' }), { transport, wait: noWait }).sendMessage('42', 'x')
    expect(calls[0]!.connectAddress).toBe('149.154.167.220')
    // Адрес в запросе — по имени: из него берутся SNI и Host.
    expect(calls[0]!.url.startsWith('https://api.telegram.org/')).toBe(true)
  })
})

/** Поддельный `https.request`: сети нет, ответ — из теста. */
function fakeRequest(reply: { status: number; body: string }) {
  const captured: { options?: Record<string, unknown> } = {}
  const requestFn = ((options: Record<string, unknown>, callback: (response: EventEmitter) => void) => {
    captured.options = options
    const request = new EventEmitter() as EventEmitter & { destroy: (error: Error) => void; end: () => void }
    request.destroy = (error) => request.emit('error', error)
    request.end = () => {
      const response = Object.assign(new EventEmitter(), { statusCode: reply.status })
      callback(response)
      setImmediate(() => {
        response.emit('data', Buffer.from(reply.body))
        response.emit('end')
      })
    }
    return request
  }) as unknown as Parameters<typeof createHttpsTransport>[0]
  return { requestFn, captured }
}

describe('подключение к запасному IP', () => {
  it('соединение — на IP, SNI и Host — api.telegram.org, проверка сертификата не отключена', async () => {
    const { requestFn, captured } = fakeRequest({ status: 200, body: '{"ok":true}' })
    await createHttpsTransport(requestFn)({
      url: `https://api.telegram.org/bot${TOKEN}/sendMessage`,
      headers: { 'content-type': 'application/json' },
      body: '{}',
      timeoutMs: 1000,
      ca: null,
      connectAddress: '149.154.167.220',
    })
    expect(captured.options).toMatchObject({
      hostname: '149.154.167.220',
      servername: 'api.telegram.org',
      port: 443,
      path: `/bot${TOKEN}/sendMessage`,
      headers: { host: 'api.telegram.org' },
    })
    expect(captured.options).not.toHaveProperty('rejectUnauthorized')
  })

  it('без IP — обычное подключение по имени, без servername и Host', async () => {
    const { requestFn, captured } = fakeRequest({ status: 200, body: '{}' })
    await createHttpsTransport(requestFn)({
      url: 'https://api.telegram.org/botX/sendMessage',
      headers: {},
      body: '{}',
      timeoutMs: 1000,
      ca: null,
    })
    expect(captured.options?.hostname).toBe('api.telegram.org')
    expect(captured.options).not.toHaveProperty('servername')
    expect(captured.options?.headers).not.toHaveProperty('host')
  })
})

describe('настройки бота', () => {
  const TOUCHED = [
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_BOT_USERNAME',
    'TELEGRAM_WEBHOOK_SECRET',
    'TELEGRAM_API_BASE',
    'TELEGRAM_API_IP',
  ]
  let saved: Record<string, string | undefined> = {}
  beforeEach(() => {
    saved = Object.fromEntries(TOUCHED.map((name) => [name, process.env[name]]))
    for (const name of TOUCHED) delete process.env[name]
  })
  afterEach(() => {
    for (const name of TOUCHED) {
      if (saved[name] === undefined) delete process.env[name]
      else process.env[name] = saved[name]
    }
  })

  it('по умолчанию бот выключен, база — api.telegram.org, IP не задан', () => {
    expect(getIntegrationsConfig().telegram).toMatchObject({
      botToken: null,
      enabled: false,
      apiBase: 'https://api.telegram.org',
      apiIp: null,
    })
  })

  it('включён, только когда есть токен, имя бота и секрет вебхука', () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN
    expect(getIntegrationsConfig().telegram.enabled).toBe(false)
    process.env.TELEGRAM_BOT_USERNAME = '@skilllink_bot'
    expect(getIntegrationsConfig().telegram.enabled).toBe(false)
    process.env.TELEGRAM_WEBHOOK_SECRET = 'hook'
    expect(getIntegrationsConfig().telegram).toMatchObject({ enabled: true, botUsername: 'skilllink_bot' })
  })

  it('IP — только настоящий IP, база — только http(s), завершающий слэш убирается', () => {
    process.env.TELEGRAM_API_IP = 'api.telegram.org'
    process.env.TELEGRAM_API_BASE = 'ftp://example.org'
    expect(getIntegrationsConfig().telegram).toMatchObject({ apiIp: null, apiBase: 'https://api.telegram.org' })

    process.env.TELEGRAM_API_IP = '149.154.167.220'
    process.env.TELEGRAM_API_BASE = 'http://localhost:8081/'
    expect(getIntegrationsConfig().telegram).toMatchObject({
      apiIp: '149.154.167.220',
      apiBase: 'http://localhost:8081',
    })
  })
})
