import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MaxConfig } from '@/integrations/config'

/**
 * Вебхук MAX через сам маршрут (решение 144): секрет заголовка, дедупликация
 * повторов, привязка по диплинку. База и MAX подменены.
 */

const mocks = vi.hoisted(() => ({
  seen: new Set<string>(),
  audit: [] as unknown[],
  after: vi.fn(),
  maxSend: vi.fn(async () => ({ ok: true })),
  max: null as MaxConfig | null,
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
  return { ...original, getIntegrationsConfig: () => ({ ...original.getIntegrationsConfig(), max: mocks.max }) }
})
vi.mock('@/integrations/max', () => ({ getMaxClient: () => ({ enabled: mocks.max?.enabled ?? false, sendMessage: mocks.maxSend }) }))

const { POST } = await import('./route')

function maxConfig(overrides: Partial<MaxConfig> = {}): MaxConfig {
  return {
    botToken: 'tok',
    botUsername: 'skilllink_max_bot',
    webhookSecret: 'wh-secret',
    apiBase: 'https://platform-api2.max.ru',
    timeoutMs: 1000,
    enabled: true,
    ...overrides,
  }
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://x.test/api/channels/max/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mocks.seen.clear()
  mocks.audit.length = 0
  mocks.after.mockClear()
  mocks.maxSend.mockClear()
})
afterEach(() => {
  mocks.max = null
})

const update = { update_type: 'message_created', message: { sender: { user_id: 1 }, body: { mid: 'm1', text: 'сегодня' } } }

describe('POST /api/channels/max/webhook', () => {
  it('без секрета — 403, тело не читается', async () => {
    mocks.max = maxConfig()
    const response = await POST(request(update), {})
    expect(response.status).toBe(403)
    expect(mocks.after).not.toHaveBeenCalled()
  })

  it('чужой секрет — 403', async () => {
    mocks.max = maxConfig()
    const response = await POST(request(update, { 'x-max-bot-api-secret': 'wrong' }), {})
    expect(response.status).toBe(403)
  })

  it('MAX_WEBHOOK_SECRET не задан — 403 для любого запроса (канал «для галочки»)', async () => {
    mocks.max = maxConfig({ webhookSecret: null })
    const response = await POST(request(update, { 'x-max-bot-api-secret': 'anything' }), {})
    expect(response.status).toBe(403)
  })

  it('верный секрет — 200 { accepted: true }, обработка после ответа', async () => {
    mocks.max = maxConfig()
    const response = await POST(request(update, { 'x-max-bot-api-secret': 'wh-secret' }), {})
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { accepted: true } })
    expect(mocks.after).toHaveBeenCalledTimes(1)
  })

  it('повтор того же mid — тихий 200 без повторной обработки', async () => {
    mocks.max = maxConfig()
    const headers = { 'x-max-bot-api-secret': 'wh-secret' }
    await POST(request(update, headers), {})
    expect(mocks.after).toHaveBeenCalledTimes(1)
    const second = await POST(request(update, headers), {})
    expect(second.status).toBe(200)
    expect(mocks.after).toHaveBeenCalledTimes(1)
  })

  it('нераспознанное тело — { accepted: false }, тоже 200', async () => {
    mocks.max = maxConfig()
    const response = await POST(request({ garbage: true }, { 'x-max-bot-api-secret': 'wh-secret' }), {})
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { accepted: false } })
  })
})
