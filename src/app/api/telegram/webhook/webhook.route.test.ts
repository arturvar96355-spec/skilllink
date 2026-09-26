import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { TelegramConfig } from '@/integrations/config'

/**
 * Вебхук и смена секрета через сами маршруты (решение 123): база отметок
 * и секретов — в памяти, Telegram подменён. Проверяется то, что увидит Telegram
 * и администратор: коды ответов, отсутствие секрета в ответе и журнале.
 */

const mocks = vi.hoisted(() => ({
  seen: new Set<number>(),
  storedHash: null as string | null,
  setWebhookCalls: [] as Array<{ url: string; secret: string }>,
  audit: [] as unknown[],
  after: vi.fn(),
  user: null as CurrentUser | null,
}))

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: mocks.after,
}))
vi.mock('@/shared/auth/auth', () => ({ resolveSecret: () => 'auth-secret' }))
vi.mock('@/shared/auth/current-user', () => ({
  getCurrentUser: async () => mocks.user,
}))
vi.mock('@/shared/audit/audit', () => ({
  writeAudit: async (entry: unknown) => {
    mocks.audit.push(entry)
  },
}))
vi.mock('@/modules/telegram/telegram.repo', () => ({
  markUpdateSeen: async (id: number) => (mocks.seen.has(id) ? false : (mocks.seen.add(id), true)),
  purgeSeenUpdates: async () => 0,
  findSecretHash: async () => mocks.storedHash,
  saveSecretHash: async (_name: string, hash: string) => {
    mocks.storedHash = hash
    return new Date('2026-09-26T10:00:00Z')
  },
}))
vi.mock('@/integrations/config', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/integrations/config')>()
  const telegram: TelegramConfig = {
    botToken: '123456789:AAHfakeTokenForTests_abcdefghijklmnopq',
    botUsername: 'skilllink_bot',
    webhookSecret: 'old-secret',
    apiBase: original.TELEGRAM_DEFAULT_API_BASE,
    apiIp: null,
    timeoutMs: 1000,
    enabled: true,
  }
  return { ...original, getIntegrationsConfig: () => ({ ...original.getIntegrationsConfig(), telegram }) }
})
vi.mock('@/integrations/telegram', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/integrations/telegram')>()
  class FakeClient extends original.TelegramClient {
    override async setWebhook(url: string, secret: string) {
      mocks.setWebhookCalls.push({ url, secret })
      return { ok: true as const }
    }
  }
  return { ...original, TelegramClient: FakeClient }
})

const webhook = await import('./route')
const rotate = await import('@/app/api/admin/telegram/rotate-webhook-secret/route')
const { captureLog } = await import('@/shared/log/logger')

const admin: CurrentUser = { id: 'cmadmin', email: 'admin@example.test', fullName: 'Админ', role: 'ADMIN', universityId: null }

function post(secret: string | null, updateId: number): Promise<Response> {
  return webhook.POST(
    new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret }) },
      body: JSON.stringify({ update_id: updateId, message: { chat: { id: 42, type: 'private' }, text: '/today' } }),
    }),
    {} as never,
  )
}

let logLines: string[] = []
let restoreLog: () => void = () => {}

beforeEach(() => {
  mocks.seen.clear()
  mocks.storedHash = null
  mocks.setWebhookCalls.length = 0
  mocks.audit.length = 0
  mocks.after.mockReset()
  mocks.user = admin
  logLines = []
  restoreLog = captureLog((_level, line) => logLines.push(line))
  vi.stubEnv('AUTH_URL', 'https://skilllink.test')
})
afterEach(() => {
  restoreLog()
  vi.unstubAllEnvs()
})

describe('вебхук Telegram через маршрут', () => {
  it('без секрета и с чужим — 403; с верным — 200 и команда после ответа', async () => {
    expect((await post(null, 1)).status).toBe(403)
    expect((await post('wrong', 2)).status).toBe(403)
    const ok = await post('old-secret', 3)
    expect(ok.status).toBe(200)
    expect(mocks.after).toHaveBeenCalledTimes(1)
  })

  it('повтор update_id — тихий 200 без повторного выполнения', async () => {
    const first = await post('old-secret', 10)
    const repeat = await post('old-secret', 10)
    expect([first.status, repeat.status]).toEqual([200, 200])
    expect(await repeat.json()).toEqual(await first.json())
    expect(mocks.after).toHaveBeenCalledTimes(1)
  })
})

describe('смена секрета вебхука через маршрут', () => {
  it('старый секрет — 403, новый — 200; секрета нет ни в ответе, ни в журнале', async () => {
    const response = await rotate.POST(new Request('http://localhost/api/admin/telegram/rotate-webhook-secret', { method: 'POST' }), {} as never)
    const text = await response.text()
    expect(response.status).toBe(200)
    expect(mocks.setWebhookCalls).toHaveLength(1)
    const secret = mocks.setWebhookCalls[0]!.secret

    expect(text).not.toContain(secret)
    expect(JSON.parse(text)).toEqual({
      data: { rotatedAt: '2026-09-26T10:00:00.000Z', webhookUrl: 'https://skilllink.test/api/telegram/webhook' },
    })

    expect((await post('old-secret', 20)).status).toBe(403)
    expect((await post(secret, 21)).status).toBe(200)

    expect(mocks.audit).toEqual([
      expect.objectContaining({ action: 'telegram.webhook_secret_rotated', objectType: 'SystemSecret' }),
    ])
    expect(JSON.stringify(mocks.audit)).not.toContain(secret)
    expect(logLines.join('\n')).not.toContain(secret)
  })

  it('не администратор — 403, Telegram не вызывается', async () => {
    mocks.user = { ...admin, role: 'MANAGER' }
    const response = await rotate.POST(new Request('http://localhost/api/admin/telegram/rotate-webhook-secret', { method: 'POST' }), {} as never)
    expect(response.status).toBe(403)
    expect(mocks.setWebhookCalls).toHaveLength(0)
  })
})
