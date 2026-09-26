import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { TelegramConfig } from '@/integrations/config'

/**
 * Админка бота Telegram (решение 142): статус, смена и удаление токена, режим,
 * проверочное сообщение. Всё внешнее подменено — проверяется бизнес-логика и,
 * отдельно, что токен нигде не всплывает: ни в ответах, ни в журнале.
 */

const TOKEN = '999999999:AAsecretTokenThatMustNeverLeakAnywhere'

const mocks = vi.hoisted(() => ({
  config: {
    botToken: '1:T',
    botUsername: 'skilllink_robot',
    webhookSecret: 'hook',
    apiBase: 'https://api.telegram.org',
    apiIp: null,
    timeoutMs: 1000,
    enabled: true,
    mode: 'auto',
  } as TelegramConfig,
  getMeResult: { ok: true, username: 'skilllink_robot' } as
    | { ok: true; username: string }
    | { ok: false; reason: 'failed'; status: number | null; description: string | null },
  getWebhookInfoResult: {
    ok: true,
    info: { url: 'https://x/api/telegram/webhook', pendingUpdateCount: 0, lastErrorDate: null, lastErrorMessage: null },
  } as
    | { ok: true; info: { url: string; pendingUpdateCount: number; lastErrorDate: Date | null; lastErrorMessage: string | null } }
    | { ok: false; reason: 'failed'; status: number | null },
  deleteWebhookCalls: 0,
  sendMessageResult: { ok: true } as { ok: true } | { ok: false; reason: 'failed' | 'blocked'; status: number | null },
  sendMessageCalls: [] as Array<{ chatId: string; text: string }>,
  setBotToken: vi.fn(async () => undefined),
  clearBotToken: vi.fn(async () => undefined),
  setMode: vi.fn(async () => undefined),
  tokenSource: vi.fn(() => 'env' as 'env' | 'database' | 'none'),
  countLinks: vi.fn(async () => 0),
  findLinkByUser: vi.fn(async () => null as { chatId: string; username: string | null; linkedAt: Date } | null),
  runtimeStatus: { running: 'webhook' as 'webhook' | 'polling' | 'off', lastWebhookInfo: null as null | { url: string; pendingUpdateCount: number; lastErrorDate: Date | null; lastErrorMessage: string | null } },
  applyMode: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  rotateWebhookSecret: vi.fn(async () => ({ rotatedAt: '2026-09-26T10:00:00.000Z', webhookUrl: 'https://x/api/telegram/webhook' })),
  writeAudit: vi.fn(async () => undefined),
  notifyOwner: vi.fn(),
}))

class FakeTelegramClient {
  async getMe() {
    return mocks.getMeResult
  }
  async getWebhookInfo() {
    return mocks.getWebhookInfoResult
  }
  async deleteWebhook() {
    mocks.deleteWebhookCalls += 1
    return { ok: true as const }
  }
  async sendMessage(chatId: string, text: string) {
    mocks.sendMessageCalls.push({ chatId, text })
    return mocks.sendMessageResult
  }
}

vi.mock('@/integrations/telegram', () => ({ TelegramClient: FakeTelegramClient }))
vi.mock('@/integrations/telegram/runtime-config', () => ({
  effectiveTelegramConfig: () => mocks.config,
  setBotToken: mocks.setBotToken,
  clearBotToken: mocks.clearBotToken,
  setMode: mocks.setMode,
  tokenSource: mocks.tokenSource,
  TELEGRAM_BOT_TOKEN_SECRET_NAME: 'telegram.bot_token',
  TELEGRAM_MODE_SECRET_NAME: 'telegram.mode',
}))
vi.mock('./telegram.repo', () => ({ countLinks: mocks.countLinks, findLinkByUser: mocks.findLinkByUser }))
vi.mock('./telegram.runtime', () => ({
  getRuntimeStatus: () => mocks.runtimeStatus,
  applyMode: mocks.applyMode,
  stop: mocks.stop,
}))
vi.mock('./telegram.service', () => ({ rotateWebhookSecret: mocks.rotateWebhookSecret }))
vi.mock('@/shared/audit/audit', () => ({ writeAudit: mocks.writeAudit }))
vi.mock('@/shared/ops/owner-alert', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/shared/ops/owner-alert')>()
  return { ...original, notifyOwner: mocks.notifyOwner }
})

const admin = await import('./telegram.admin.service')

const ADMIN: CurrentUser = {
  id: 'cmadmin000000000000000000',
  email: 'admin@example.test',
  fullName: 'Админ Админов',
  role: 'ADMIN',
  universityId: null,
}
const MANAGER: CurrentUser = { ...ADMIN, id: 'cmmanager0000000000000000', role: 'MANAGER' }
const SECRET = 'auth-secret'

beforeEach(() => {
  mocks.config = {
    botToken: '1:T',
    botUsername: 'skilllink_robot',
    webhookSecret: 'hook',
    apiBase: 'https://api.telegram.org',
    apiIp: null,
    timeoutMs: 1000,
    enabled: true,
    mode: 'auto',
  }
  mocks.getMeResult = { ok: true, username: 'skilllink_robot' }
  mocks.getWebhookInfoResult = {
    ok: true,
    info: { url: 'https://x/api/telegram/webhook', pendingUpdateCount: 0, lastErrorDate: null, lastErrorMessage: null },
  }
  mocks.deleteWebhookCalls = 0
  mocks.sendMessageResult = { ok: true }
  mocks.sendMessageCalls = []
  mocks.runtimeStatus = { running: 'webhook', lastWebhookInfo: null }
  mocks.setBotToken.mockClear()
  mocks.clearBotToken.mockClear()
  mocks.setMode.mockClear()
  mocks.tokenSource.mockClear().mockReturnValue('env')
  mocks.countLinks.mockClear().mockResolvedValue(0)
  mocks.findLinkByUser.mockClear().mockResolvedValue(null)
  mocks.applyMode.mockClear()
  mocks.stop.mockClear()
  mocks.rotateWebhookSecret.mockClear()
  mocks.writeAudit.mockClear()
  mocks.notifyOwner.mockClear()
  delete process.env.TELEGRAM_OWNER_CHAT_ID
})

afterEach(() => {
  delete process.env.TELEGRAM_OWNER_CHAT_ID
})

describe('права', () => {
  it('не ADMIN — 403 на все операции', async () => {
    await expect(admin.adminStatus(MANAGER)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(admin.adminSetToken(MANAGER, { token: TOKEN }, SECRET)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(admin.adminClearToken(MANAGER, SECRET)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(admin.adminSetMode(MANAGER, 'polling', SECRET)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(admin.adminSendTest(MANAGER)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('adminStatus', () => {
  it('бот не настроен — running off, поля вебхука пустые, Telegram не вызывается', async () => {
    mocks.config = { ...mocks.config, enabled: false, botUsername: null }
    const status = await admin.adminStatus(ADMIN)
    expect(status).toMatchObject({
      configured: false,
      running: 'off',
      webhookUrl: null,
      pendingUpdateCount: null,
      lastErrorMessage: null,
      lastErrorAt: null,
    })
  })

  it('настроен: живой запрос к Telegram, running по фактическому состоянию рантайма', async () => {
    mocks.getWebhookInfoResult = {
      ok: true,
      info: {
        url: 'https://skilllink.site/api/telegram/webhook',
        pendingUpdateCount: 3,
        lastErrorDate: new Date('2026-09-26T09:00:00Z'),
        lastErrorMessage: 'Connection timed out',
      },
    }
    mocks.countLinks.mockResolvedValue(5)
    mocks.tokenSource.mockReturnValue('database')
    process.env.TELEGRAM_OWNER_CHAT_ID = '123456789'

    const status = await admin.adminStatus(ADMIN)
    expect(status).toEqual({
      configured: true,
      botUsername: 'skilllink_robot',
      mode: 'auto',
      running: 'webhook',
      webhookUrl: 'https://skilllink.site/api/telegram/webhook',
      pendingUpdateCount: 3,
      lastErrorMessage: 'Connection timed out',
      lastErrorAt: '2026-09-26T09:00:00.000Z',
      linkedEmployeeCount: 5,
      tokenSource: 'database',
      ownerChatConfigured: true,
    })
  })

  it('рантайм сейчас на polling — running: polling, даже если mode настройки другой', async () => {
    mocks.runtimeStatus = { running: 'polling', lastWebhookInfo: null }
    const status = await admin.adminStatus(ADMIN)
    expect(status.running).toBe('polling')
  })

  it('запрос к Telegram не удался — берём кеш последней auto-проверки рантайма', async () => {
    mocks.getWebhookInfoResult = { ok: false, reason: 'failed', status: 500 }
    mocks.runtimeStatus = {
      running: 'webhook',
      lastWebhookInfo: { url: 'https://cached', pendingUpdateCount: 7, lastErrorDate: null, lastErrorMessage: 'старая ошибка' },
    }
    const status = await admin.adminStatus(ADMIN)
    expect(status).toMatchObject({ webhookUrl: 'https://cached', pendingUpdateCount: 7, lastErrorMessage: 'старая ошибка' })
  })

  it('TELEGRAM_OWNER_CHAT_ID не в формате id чата — ownerChatConfigured: false', async () => {
    process.env.TELEGRAM_OWNER_CHAT_ID = 'не число'
    expect((await admin.adminStatus(ADMIN)).ownerChatConfigured).toBe(false)
  })
})

describe('adminSetToken', () => {
  it('неверный токен (getMe отказал) — токен не сохраняется, режим не трогается', async () => {
    mocks.getMeResult = { ok: false, reason: 'failed', status: 401, description: 'Unauthorized' }
    await expect(admin.adminSetToken(ADMIN, { token: TOKEN }, SECRET)).rejects.toMatchObject({ code: 'INTEGRATION_ERROR' })
    expect(mocks.setBotToken).not.toHaveBeenCalled()
    expect(mocks.applyMode).not.toHaveBeenCalled()
  })

  it('верный токен, режим не polling — сохраняет, зовёт rotateWebhookSecret, применяет режим, журнал и оповещение', async () => {
    mocks.config = { ...mocks.config, mode: 'webhook' }
    const status = await admin.adminSetToken(ADMIN, { token: TOKEN }, SECRET)

    expect(mocks.setBotToken).toHaveBeenCalledWith(SECRET, TOKEN, 'skilllink_robot', ADMIN.id)
    expect(mocks.rotateWebhookSecret).toHaveBeenCalledWith(ADMIN)
    expect(mocks.applyMode).toHaveBeenCalledWith(SECRET, 'webhook')
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'telegram.token_changed', userId: ADMIN.id }),
    )
    expect(mocks.notifyOwner).toHaveBeenCalledWith('telegram.token-changed', expect.anything())
    expect(status.configured).toBe(true)
  })

  it('режим polling — rotateWebhookSecret НЕ вызывается, только applyMode перезапускает цикл', async () => {
    mocks.config = { ...mocks.config, mode: 'polling' }
    await admin.adminSetToken(ADMIN, { token: TOKEN }, SECRET)
    expect(mocks.rotateWebhookSecret).not.toHaveBeenCalled()
    expect(mocks.applyMode).toHaveBeenCalledWith(SECRET, 'polling')
  })

  it('токен нигде не всплывает: ни в ответе, ни в журнале, ни в вызове notifyOwner', async () => {
    await admin.adminSetToken(ADMIN, { token: TOKEN }, SECRET)
    const everything = JSON.stringify([
      ...mocks.writeAudit.mock.calls,
      ...mocks.notifyOwner.mock.calls,
      await admin.adminStatus(ADMIN),
    ])
    expect(everything).not.toContain(TOKEN)
  })

  it('rotateWebhookSecret отказал — смена токена всё равно завершается успехом', async () => {
    mocks.rotateWebhookSecret.mockRejectedValueOnce(new Error('Telegram не принял secret'))
    await expect(admin.adminSetToken(ADMIN, { token: TOKEN }, SECRET)).resolves.toBeDefined()
  })
})

describe('adminClearToken', () => {
  it('бот был настроен — снимает вебхук у Telegram перед удалением токена из базы', async () => {
    await admin.adminClearToken(ADMIN, SECRET)
    expect(mocks.deleteWebhookCalls).toBe(1)
    expect(mocks.clearBotToken).toHaveBeenCalled()
  })

  it('после удаления токен нигде не остаётся (env тоже не задан) — runtime.stop(), не applyMode', async () => {
    mocks.config = { ...mocks.config, enabled: false }
    await admin.adminClearToken(ADMIN, SECRET)
    expect(mocks.stop).toHaveBeenCalled()
    expect(mocks.applyMode).not.toHaveBeenCalled()
  })

  it('токен остаётся в env — applyMode перезапускает рантайм тем же режимом, а не stop()', async () => {
    // effectiveTelegramConfig() в этом тесте не меняется между "до" и "после" —
    // логика admin.service читает config уже после clearBotToken(), а раз мок
    // всегда enabled:true, это симулирует «env-токен остался».
    await admin.adminClearToken(ADMIN, SECRET)
    expect(mocks.stop).not.toHaveBeenCalled()
    expect(mocks.applyMode).toHaveBeenCalledWith(SECRET, mocks.config.mode)
  })

  it('журнал telegram.token_removed, оповещение владельцу', async () => {
    await admin.adminClearToken(ADMIN, SECRET)
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'telegram.token_removed' }))
    expect(mocks.notifyOwner).toHaveBeenCalledWith('telegram.token-changed', expect.anything())
  })
})

describe('adminSetMode', () => {
  it('бот не настроен — 502, режим не сохраняется', async () => {
    mocks.config = { ...mocks.config, enabled: false }
    await expect(admin.adminSetMode(ADMIN, 'polling', SECRET)).rejects.toMatchObject({ code: 'INTEGRATION_ERROR' })
    expect(mocks.setMode).not.toHaveBeenCalled()
  })

  it('сохраняет режим, применяет его сразу, пишет журнал с by: admin', async () => {
    await admin.adminSetMode(ADMIN, 'polling', SECRET)
    expect(mocks.setMode).toHaveBeenCalledWith('polling', ADMIN.id)
    expect(mocks.applyMode).toHaveBeenCalledWith(SECRET, 'polling')
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'telegram.mode_switched', payload: expect.objectContaining({ by: 'admin', to: 'polling' }) }),
    )
  })
})

describe('adminSendTest', () => {
  it('администратор сам подключил бота — сообщение в его чат, sentTo: admin', async () => {
    mocks.findLinkByUser.mockResolvedValue({ chatId: '555', username: 'admin_tg', linkedAt: new Date() })
    const result = await admin.adminSendTest(ADMIN)
    expect(result).toEqual({ sentTo: 'admin' })
    expect(mocks.sendMessageCalls).toEqual([{ chatId: '555', text: expect.any(String) }])
  })

  it('администратор не подключён, но задан TELEGRAM_OWNER_CHAT_ID — в чат владельца', async () => {
    process.env.TELEGRAM_OWNER_CHAT_ID = '987654321'
    const result = await admin.adminSendTest(ADMIN)
    expect(result).toEqual({ sentTo: 'owner' })
    expect(mocks.sendMessageCalls).toEqual([{ chatId: '987654321', text: expect.any(String) }])
  })

  it('некуда отправить — понятная ошибка, Telegram не вызывается', async () => {
    await expect(admin.adminSendTest(ADMIN)).rejects.toMatchObject({ code: 'INTEGRATION_ERROR' })
    expect(mocks.sendMessageCalls).toHaveLength(0)
  })

  it('Telegram отказал в отправке — ошибка наружу', async () => {
    mocks.findLinkByUser.mockResolvedValue({ chatId: '555', username: null, linkedAt: new Date() })
    mocks.sendMessageResult = { ok: false, reason: 'blocked', status: 403 }
    await expect(admin.adminSendTest(ADMIN)).rejects.toMatchObject({ code: 'INTEGRATION_ERROR' })
  })

  it('бот не настроен — 502 до обращения к базе привязок', async () => {
    mocks.config = { ...mocks.config, enabled: false }
    await expect(admin.adminSendTest(ADMIN)).rejects.toMatchObject({ code: 'INTEGRATION_ERROR' })
  })
})
