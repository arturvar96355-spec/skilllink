import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MaxConfig } from '../config'
import { MaxClient, MAX_MAX_TEXT } from './max.client'

/**
 * Клиент Bot API MAX (решение 144). Сети нет: `fetch` подменён — проверяется
 * формат запроса, обработка ошибок, три попытки с джиттером и что токен
 * не попадает в журнал.
 */

const TOKEN = 'max-secret-token-abc123'

function config(overrides: Partial<MaxConfig> = {}): MaxConfig {
  return {
    botToken: TOKEN,
    botUsername: 'skilllink_bot',
    webhookSecret: 'hook-secret',
    apiBase: 'https://platform-api2.max.ru',
    timeoutMs: 1000,
    enabled: true,
    ...overrides,
  }
}

/** Ответ на каждый вызов по очереди; исключение — сбой сети. */
function scripted(replies: Array<{ status: number; body: string } | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const reply = replies[calls.length - 1] ?? replies.at(-1)!
    if (reply instanceof Error) throw reply
    return {
      status: reply.status,
      text: async () => reply.body,
    } as Response
  })
  return { fetchImpl, calls }
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
  it('шлёт POST на /messages с user_id в адресе и токеном в заголовке Authorization', async () => {
    const { fetchImpl, calls } = scripted([{ status: 200, body: '{}' }])
    const result = await new MaxClient(config(), { fetchImpl, wait: noWait }).sendMessage('42', 'Привет')

    expect(result).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://platform-api2.max.ru/messages?user_id=42')
    expect(calls[0]!.init.method).toBe('POST')
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(TOKEN)
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ text: 'Привет' })
  })

  it('без токена — disabled, ничего не отправляет', async () => {
    const { fetchImpl, calls } = scripted([{ status: 200, body: '{}' }])
    const client = new MaxClient(config({ botToken: null, enabled: false }), { fetchImpl, wait: noWait })
    expect(client.enabled).toBe(false)
    expect(await client.sendMessage('42', 'x')).toEqual({ ok: false, reason: 'disabled', status: null })
    expect(calls).toHaveLength(0)
  })

  it('403/404 — blocked и без повтора', async () => {
    const { fetchImpl, calls } = scripted([{ status: 403, body: '{"code":"user.access.forbidden"}' }])
    const result = await new MaxClient(config(), { fetchImpl, wait: noWait }).sendMessage('42', 'x')
    expect(result).toEqual({ ok: false, reason: 'blocked', status: 403 })
    expect(calls).toHaveLength(1)
  })

  it('400 не повторяется', async () => {
    const { fetchImpl, calls } = scripted([{ status: 400, body: '{"code":"bad.request"}' }])
    const result = await new MaxClient(config(), { fetchImpl, wait: noWait }).sendMessage('42', 'x')
    expect(result).toEqual({ ok: false, reason: 'failed', status: 400 })
    expect(calls).toHaveLength(1)
  })

  it('500 повторяется три раза с джиттером, потом failed', async () => {
    const { fetchImpl, calls } = scripted([
      { status: 500, body: '{}' },
      { status: 500, body: '{}' },
      { status: 500, body: '{}' },
    ])
    const waits: number[] = []
    const result = await new MaxClient(config(), { fetchImpl, wait: async (ms) => void waits.push(ms) }).sendMessage('42', 'x')
    expect(result).toEqual({ ok: false, reason: 'failed', status: 500 })
    expect(calls).toHaveLength(3)
    expect(waits).toHaveLength(2)
    // Джиттер ±30%: пауза не строго фиксированная, но в разумных пределах базовой.
    expect(waits[0]).toBeGreaterThan(0)
    expect(waits[0]).toBeLessThan(1000)
  })

  it('успех после повтора — сообщение доходит', async () => {
    const { fetchImpl, calls } = scripted([{ status: 500, body: '{}' }, { status: 200, body: '{}' }])
    const result = await new MaxClient(config(), { fetchImpl, wait: noWait }).sendMessage('42', 'x')
    expect(result).toEqual({ ok: true })
    expect(calls).toHaveLength(2)
  })

  it('токен не попадает в журнал, даже если он есть в тексте ошибки сети', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`fetch failed: unauthorized with ${TOKEN}`)
    })
    await new MaxClient(config(), { fetchImpl, wait: noWait }).sendMessage('42', 'секретный текст')
    const logged = warn.mock.calls
      .flat()
      .map((line: unknown) => String(line).replace(/"ts":"[^"]*"/, ''))
      .join('\n')
    expect(logged).not.toContain(TOKEN)
    expect(logged).toContain('[токен скрыт]')
  })

  it('текст длиннее предела обрезается, а не отвергается', async () => {
    const { fetchImpl, calls } = scripted([{ status: 200, body: '{}' }])
    const longText = 'x'.repeat(MAX_MAX_TEXT + 100)
    await new MaxClient(config(), { fetchImpl, wait: noWait }).sendMessage('42', longText)
    const sentText = (JSON.parse(calls[0]!.init.body as string) as { text: string }).text
    expect(sentText.length).toBe(MAX_MAX_TEXT)
    expect(sentText.endsWith('…')).toBe(true)
  })
})

describe('subscribe', () => {
  it('подписывает вебхук секретом в теле, не в адресе', async () => {
    const { fetchImpl, calls } = scripted([{ status: 200, body: '{}' }])
    const result = await new MaxClient(config(), { fetchImpl, wait: noWait }).subscribe('https://x.test/api/channels/max/webhook', 'wh-secret')
    expect(result).toEqual({ ok: true })
    expect(calls[0]!.url).not.toContain('wh-secret')
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({
      url: 'https://x.test/api/channels/max/webhook',
      secret: 'wh-secret',
    })
  })
})
