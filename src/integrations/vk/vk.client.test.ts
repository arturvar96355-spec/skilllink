import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VkConfig } from '../config'
import { VkClient, VK_MAX_TEXT } from './vk.client'

/**
 * Клиент VK API (messages.send, решение 144). Сети нет: `fetch` подменён —
 * проверяется формат запроса, обработка ошибок VK (error_code), три попытки
 * с джиттером и что токен сообщества не попадает в журнал.
 */

const TOKEN = 'vk-community-secret-token-xyz'

function config(overrides: Partial<VkConfig> = {}): VkConfig {
  return {
    groupToken: TOKEN,
    groupId: '123',
    confirmationCode: 'confirm-code',
    secret: 'callback-secret',
    apiBase: 'https://api.vk.com/method',
    apiVersion: '5.199',
    timeoutMs: 1000,
    enabled: true,
    ...overrides,
  }
}

function scripted(replies: Array<{ status: number; body: string } | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const reply = replies[calls.length - 1] ?? replies.at(-1)!
    if (reply instanceof Error) throw reply
    return { status: reply.status, text: async () => reply.body } as Response
  })
  return { fetchImpl, calls }
}

const noWait = async () => {}
const fixedRandomId = () => 777

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  warn.mockRestore()
})

function bodyParams(init: RequestInit): URLSearchParams {
  return new URLSearchParams(init.body as string)
}

describe('sendMessage', () => {
  it('шлёт messages.send с access_token, v, group_id, peer_id, message, random_id', async () => {
    const { fetchImpl, calls } = scripted([{ status: 200, body: '{"response":1}' }])
    const result = await new VkClient(config(), { fetchImpl, wait: noWait, randomId: fixedRandomId }).sendMessage('42', 'Привет')

    expect(result).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://api.vk.com/method/messages.send')
    const params = bodyParams(calls[0]!.init)
    expect(params.get('access_token')).toBe(TOKEN)
    expect(params.get('v')).toBe('5.199')
    expect(params.get('group_id')).toBe('123')
    expect(params.get('peer_id')).toBe('42')
    expect(params.get('message')).toBe('Привет')
    expect(params.get('random_id')).toBe('777')
  })

  it('без токена или id сообщества — disabled, ничего не отправляет', async () => {
    const { fetchImpl, calls } = scripted([{ status: 200, body: '{"response":1}' }])
    const client = new VkClient(config({ groupToken: null, enabled: false }), { fetchImpl, wait: noWait })
    expect(client.enabled).toBe(false)
    expect(await client.sendMessage('42', 'x')).toEqual({ ok: false, reason: 'disabled', status: null, errorCode: null })
    expect(calls).toHaveLength(0)
  })

  it('error_code 901 (чёрный список) — blocked и без повтора', async () => {
    const { fetchImpl, calls } = scripted([{ status: 200, body: '{"error":{"error_code":901,"error_msg":"blacklisted"}}' }])
    const result = await new VkClient(config(), { fetchImpl, wait: noWait }).sendMessage('42', 'x')
    expect(result).toEqual({ ok: false, reason: 'blocked', status: 200, errorCode: 901 })
    expect(calls).toHaveLength(1)
  })

  it('error_code 100 (неверные параметры) не повторяется', async () => {
    const { fetchImpl, calls } = scripted([{ status: 200, body: '{"error":{"error_code":100,"error_msg":"bad params"}}' }])
    const result = await new VkClient(config(), { fetchImpl, wait: noWait }).sendMessage('42', 'x')
    expect(result).toEqual({ ok: false, reason: 'failed', status: 200, errorCode: 100 })
    expect(calls).toHaveLength(1)
  })

  it('error_code 6 (много запросов) повторяется, потом успех', async () => {
    const { fetchImpl, calls } = scripted([
      { status: 200, body: '{"error":{"error_code":6,"error_msg":"too many requests"}}' },
      { status: 200, body: '{"response":1}' },
    ])
    const result = await new VkClient(config(), { fetchImpl, wait: noWait }).sendMessage('42', 'x')
    expect(result).toEqual({ ok: true })
    expect(calls).toHaveLength(2)
  })

  it('500 повторяется три раза, потом failed', async () => {
    const { fetchImpl, calls } = scripted([{ status: 500, body: '' }, { status: 500, body: '' }, { status: 500, body: '' }])
    const waits: number[] = []
    const result = await new VkClient(config(), { fetchImpl, wait: async (ms) => void waits.push(ms) }).sendMessage('42', 'x')
    expect(result).toEqual({ ok: false, reason: 'failed', status: 500, errorCode: null })
    expect(calls).toHaveLength(3)
    expect(waits).toHaveLength(2)
  })

  it('токен сообщества не попадает в журнал', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`network error with token ${TOKEN}`)
    })
    await new VkClient(config(), { fetchImpl, wait: noWait }).sendMessage('42', 'секретный текст')
    const logged = warn.mock.calls
      .flat()
      .map((line: unknown) => String(line).replace(/"ts":"[^"]*"/, ''))
      .join('\n')
    expect(logged).not.toContain(TOKEN)
    expect(logged).toContain('[токен скрыт]')
  })

  it('текст длиннее предела обрезается, а не отвергается', async () => {
    const { fetchImpl, calls } = scripted([{ status: 200, body: '{"response":1}' }])
    const longText = 'x'.repeat(VK_MAX_TEXT + 100)
    await new VkClient(config(), { fetchImpl, wait: noWait, randomId: fixedRandomId }).sendMessage('42', longText)
    const sentText = bodyParams(calls[0]!.init).get('message')!
    expect(sentText.length).toBe(VK_MAX_TEXT)
    expect(sentText.endsWith('…')).toBe(true)
  })
})
