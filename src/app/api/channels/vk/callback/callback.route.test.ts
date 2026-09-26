import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VkConfig } from '@/integrations/config'

/**
 * Callback API VK через сам маршрут (решение 144): confirmation, secret в теле,
 * дедупликация повторов. База и VK подменены.
 */

const mocks = vi.hoisted(() => ({
  seen: new Set<string>(),
  audit: [] as unknown[],
  after: vi.fn(),
  vkSend: vi.fn(async () => ({ ok: true })),
  vk: null as VkConfig | null,
}))

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: mocks.after,
}))
vi.mock('@/shared/auth/auth', () => ({ resolveSecret: () => 'auth-secret' }))
vi.mock('@/shared/audit/audit', () => ({
  writeAudit: async (entry: unknown) => {
    mocks.audit.push(entry)
  },
}))
vi.mock('@/modules/notify-channels/notify-channels.repo', () => ({
  markUpdateSeen: async (_channel: string, id: string) => (mocks.seen.has(id) ? false : (mocks.seen.add(id), true)),
  purgeSeenUpdates: async () => 0,
  findActiveUserByChatRef: async () => null,
  findUserIdByChatRef: async () => null,
  linkAltChannel: async () => ({ previousChatRef: null }),
  findActiveUser: async () => null,
}))
vi.mock('@/integrations/config', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/integrations/config')>()
  return { ...original, getIntegrationsConfig: () => ({ ...original.getIntegrationsConfig(), vk: mocks.vk }) }
})
vi.mock('@/integrations/vk', () => ({ getVkClient: () => ({ enabled: mocks.vk?.enabled ?? false, sendMessage: mocks.vkSend }) }))

const { POST } = await import('./route')

function vkConfig(overrides: Partial<VkConfig> = {}): VkConfig {
  return {
    groupToken: 'tok',
    groupId: '1',
    confirmationCode: 'confirm-code-123',
    secret: 'callback-secret',
    apiBase: 'https://api.vk.com/method',
    apiVersion: '5.199',
    timeoutMs: 1000,
    enabled: true,
    ...overrides,
  }
}

function request(body: unknown) {
  return new Request('https://x.test/api/channels/vk/callback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mocks.seen.clear()
  mocks.audit.length = 0
  mocks.after.mockClear()
  mocks.vkSend.mockClear()
})
afterEach(() => {
  mocks.vk = null
})

describe('POST /api/channels/vk/callback', () => {
  it('confirmation отвечает открытым текстом с кодом подтверждения', async () => {
    mocks.vk = vkConfig()
    const response = await POST(request({ type: 'confirmation', group_id: 1 }), {})
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/plain')
    expect(await response.text()).toBe('confirm-code-123')
  })

  it('confirmation без VK_CONFIRMATION_CODE — 403', async () => {
    mocks.vk = vkConfig({ confirmationCode: null })
    const response = await POST(request({ type: 'confirmation', group_id: 1 }), {})
    expect(response.status).toBe(403)
  })

  it('неверный secret в событии — 403', async () => {
    mocks.vk = vkConfig()
    const response = await POST(
      request({ type: 'message_new', secret: 'wrong', event_id: '1', object: { message: { from_id: 1, text: 'сегодня' } } }),
      {},
    )
    expect(response.status).toBe(403)
  })

  it('верный secret — 200 "ok", обработка после ответа (after)', async () => {
    mocks.vk = vkConfig()
    const response = await POST(
      request({ type: 'message_new', secret: 'callback-secret', event_id: '1', object: { message: { from_id: 1, text: 'сегодня' } } }),
      {},
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
    expect(mocks.after).toHaveBeenCalledTimes(1)
  })

  it('повтор того же event_id — тихий "ok" без повторной обработки', async () => {
    mocks.vk = vkConfig()
    const body = { type: 'message_new', secret: 'callback-secret', event_id: 'dup-1', object: { message: { from_id: 1, text: 'сегодня' } } }
    await POST(request(body), {})
    expect(mocks.after).toHaveBeenCalledTimes(1)
    const second = await POST(request(body), {})
    expect(second.status).toBe(200)
    expect(await second.text()).toBe('ok')
    expect(mocks.after).toHaveBeenCalledTimes(1)
  })

  it('нераспознанное тело — тоже "ok", не 500', async () => {
    mocks.vk = vkConfig()
    const response = await POST(request({ garbage: true }), {})
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
  })
})
