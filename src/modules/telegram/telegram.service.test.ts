import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import { TELEGRAM_DEFAULT_API_BASE, type TelegramConfig } from '@/integrations/config'
import { TelegramClient } from '@/integrations/telegram'
import { createLinkToken, resetSpentLinkTokens } from './telegram.link-token'
import { BOT_REPLIES } from './telegram.rules'

/**
 * Сервис бота: привязка, команды, рассылка. База и Telegram подменены —
 * проверяется, что бот отвечает и что пишет в базу и журнал.
 */

const mocks = vi.hoisted(() => ({
  findLinkByUser: vi.fn(),
  findActiveUser: vi.fn(),
  findActiveUserByChat: vi.fn(),
  linkChat: vi.fn(),
  unlinkUser: vi.fn(),
  unlinkChat: vi.fn(),
  listActiveLinks: vi.fn(),
  findDigestStages: vi.fn(),
  findOpenRecommendationsOf: vi.fn(),
  toRecommendationDtos: vi.fn(),
  writeAudit: vi.fn(),
  markUpdateSeen: vi.fn(),
  purgeSeenUpdates: vi.fn(),
  findSecretHash: vi.fn(),
  saveSecretHash: vi.fn(),
  telegram: null as TelegramConfig | null,
}))

vi.mock('./telegram.repo', () => ({
  findLinkByUser: mocks.findLinkByUser,
  findActiveUser: mocks.findActiveUser,
  findActiveUserByChat: mocks.findActiveUserByChat,
  linkChat: mocks.linkChat,
  unlinkUser: mocks.unlinkUser,
  unlinkChat: mocks.unlinkChat,
  listActiveLinks: mocks.listActiveLinks,
  findDigestStages: mocks.findDigestStages,
  findOpenRecommendationsOf: mocks.findOpenRecommendationsOf,
  markUpdateSeen: mocks.markUpdateSeen,
  purgeSeenUpdates: mocks.purgeSeenUpdates,
  findSecretHash: mocks.findSecretHash,
  saveSecretHash: mocks.saveSecretHash,
}))
vi.mock('@/modules/recommendations/recommendations.service', () => ({
  toRecommendationDtos: mocks.toRecommendationDtos,
}))
vi.mock('@/shared/audit/audit', () => ({ writeAudit: mocks.writeAudit }))
// Расширения пульса (решение 120) — застой, встречи, «Система заметила» — ходят в базу;
// здесь проверяется бот, поэтому сводка собирается из этапов и рекомендаций, как раньше.
vi.mock('@/modules/analytics/pulse.extras', () => ({ loadPulseExtras: async () => null }))
vi.mock('@/integrations/config', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/integrations/config')>()
  return {
    ...original,
    getIntegrationsConfig: () => ({ ...original.getIntegrationsConfig(), telegram: mocks.telegram }),
  }
})

const service = await import('./telegram.service')

const SECRET = 'auth-secret'
const manager: CurrentUser = {
  id: 'cmuser0manager000000000000',
  email: 'manager@example.test',
  fullName: 'Демо Менеджер',
  role: 'MANAGER',
  universityId: null,
}
const rep: CurrentUser = { ...manager, id: 'cmuser0rep00000000000000000', role: 'UNIVERSITY_REP', universityId: 'u-1' }

function enabledConfig(overrides: Partial<TelegramConfig> = {}): TelegramConfig {
  return {
    botToken: '1:T',
    botUsername: 'skilllink_bot',
    webhookSecret: 'hook',
    apiBase: TELEGRAM_DEFAULT_API_BASE,
    apiIp: null,
    timeoutMs: 1000,
    enabled: true,
    mode: 'webhook',
    ...overrides,
  }
}

/** Клиент, который запоминает отправленное вместо отправки. */
function recordingClient(result: Awaited<ReturnType<TelegramClient['sendMessage']>> = { ok: true }) {
  const sent: Array<{ chatId: string; text: string }> = []
  const client = new TelegramClient(enabledConfig())
  vi.spyOn(client, 'sendMessage').mockImplementation(async (chatId, text) => {
    sent.push({ chatId, text })
    return result
  })
  return { client, sent }
}

let updateId = 1
function update(text: string, chat: { id: number; type: string } = { id: 777, type: 'private' }) {
  updateId += 1
  return { update_id: updateId, message: { chat, from: { username: 'ivan' }, text } }
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) if (typeof mock === 'function') mock.mockReset()
  mocks.telegram = enabledConfig()
  mocks.findDigestStages.mockResolvedValue([])
  mocks.findOpenRecommendationsOf.mockResolvedValue([])
  mocks.toRecommendationDtos.mockResolvedValue([])
  resetSpentLinkTokens()
  service.resetSeenUpdates()
  // База отметок и секретов — в памяти теста.
  const seen = new Set<number>()
  mocks.markUpdateSeen.mockImplementation(async (id: number) => (seen.has(id) ? false : (seen.add(id), true)))
  mocks.purgeSeenUpdates.mockResolvedValue(0)
  let storedHash: string | null = null
  mocks.findSecretHash.mockImplementation(async () => storedHash)
  mocks.saveSecretHash.mockImplementation(async (_name: string, hash: string) => {
    storedHash = hash
    return new Date('2026-09-26T10:00:00Z')
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('личный кабинет', () => {
  it('бот не настроен — configured=false, ссылку не выдать (502)', async () => {
    mocks.telegram = enabledConfig({ botToken: null, enabled: false })
    mocks.findLinkByUser.mockResolvedValue(null)
    expect(await service.getStatus(manager)).toMatchObject({ configured: false, available: true, linked: false })
    expect(() => service.connect(manager, SECRET)).toThrow(expect.objectContaining({ code: 'INTEGRATION_ERROR' }))
  })

  it('ссылка ведёт на бота с токеном этого пользователя', () => {
    const { url } = service.connect(manager, SECRET)
    const match = /^https:\/\/t\.me\/skilllink_bot\?start=([A-Za-z0-9_-]{1,64})$/.exec(url)
    expect(match).not.toBeNull()
  })

  it('представителю вуза сводка недоступна: available=false, ссылка — 403', async () => {
    mocks.findLinkByUser.mockResolvedValue(null)
    expect((await service.getStatus(rep)).available).toBe(false)
    expect(() => service.connect(rep, SECRET)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
  })

  it('отключение пишет журнал только если было что отключать', async () => {
    mocks.findLinkByUser.mockResolvedValue(null)
    mocks.unlinkUser.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    await service.disconnect(manager)
    await service.disconnect(manager)
    expect(mocks.writeAudit).toHaveBeenCalledTimes(1)
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'telegram.unlink', objectId: manager.id, payload: { source: 'profile' } }),
    )
  })
})

describe('вебхук', () => {
  it('без секрета или с чужим — 403', async () => {
    await expect(service.assertWebhookSecret(null)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(service.assertWebhookSecret('чужой')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(service.assertWebhookSecret('hook')).resolves.toBeUndefined()
    // Без заголовка в базу не ходим.
    mocks.findSecretHash.mockClear()
    await expect(service.assertWebhookSecret(null)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(mocks.findSecretHash).not.toHaveBeenCalled()
  })

  it('секрета нет ни в окружении, ни в базе — закрыто для всех', async () => {
    mocks.telegram = enabledConfig({ webhookSecret: null, enabled: false })
    await expect(service.assertWebhookSecret('hook')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(service.assertWebhookSecret('')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('/start с верным токеном привязывает чат, пишет журнал без чата и ника', async () => {
    mocks.findActiveUser.mockResolvedValue(manager)
    const { token } = createLinkToken(SECRET, manager.id)
    const { client, sent } = recordingClient()
    await service.handleUpdate(update(`/start ${token}`), { secret: SECRET, client })

    expect(mocks.linkChat).toHaveBeenCalledWith(manager.id, '777', 'ivan')
    expect(sent).toEqual([{ chatId: '777', text: BOT_REPLIES.linked }])
    const audit = mocks.writeAudit.mock.calls[0]![0] as { action: string; payload: unknown }
    expect(audit.action).toBe('telegram.link')
    expect(JSON.stringify(audit)).not.toMatch(/777|ivan/)
  })

  it('/start в чате, уже привязанном к другому сотруднику, — понятный отказ, чат не отбирается', async () => {
    mocks.findActiveUser.mockResolvedValue(manager)
    mocks.findActiveUserByChat.mockResolvedValue(rep)
    const { token } = createLinkToken(SECRET, manager.id)
    const { client, sent } = recordingClient()
    await service.handleUpdate(update(`/start ${token}`), { secret: SECRET, client })

    expect(mocks.linkChat).not.toHaveBeenCalled()
    expect(sent).toEqual([{ chatId: '777', text: BOT_REPLIES.chatTakenByOther }])
  })

  it('/start повторной ссылкой в СВОЁМ уже привязанном чате — перепривязка проходит', async () => {
    mocks.findActiveUser.mockResolvedValue(manager)
    mocks.findActiveUserByChat.mockResolvedValue(manager)
    const { token } = createLinkToken(SECRET, manager.id)
    const { client, sent } = recordingClient()
    await service.handleUpdate(update(`/start ${token}`), { secret: SECRET, client })

    expect(mocks.linkChat).toHaveBeenCalledWith(manager.id, '777', 'ivan')
    expect(sent).toEqual([{ chatId: '777', text: BOT_REPLIES.linked }])
  })

  it('перепривязка на ДРУГОЙ чат того же сотрудника — старый чат получает уведомление о переносе', async () => {
    mocks.findActiveUser.mockResolvedValue(manager)
    mocks.findActiveUserByChat.mockResolvedValue(null) // новый чат (888) ничей
    mocks.findLinkByUser.mockResolvedValue({ chatId: '777', username: 'ivan', linkedAt: new Date() })
    const { token } = createLinkToken(SECRET, manager.id)
    const { client, sent } = recordingClient()
    await service.handleUpdate(update(`/start ${token}`, { id: 888, type: 'private' }), { secret: SECRET, client })

    expect(mocks.linkChat).toHaveBeenCalledWith(manager.id, '888', 'ivan')
    expect(sent).toEqual([
      { chatId: '777', text: BOT_REPLIES.movedElsewhere },
      { chatId: '888', text: BOT_REPLIES.linked },
    ])
  })

  it('перепривязка в ТОТ ЖЕ чат — уведомление о переносе не отправляется', async () => {
    mocks.findActiveUser.mockResolvedValue(manager)
    mocks.findActiveUserByChat.mockResolvedValue(manager)
    mocks.findLinkByUser.mockResolvedValue({ chatId: '777', username: 'ivan', linkedAt: new Date() })
    const { token } = createLinkToken(SECRET, manager.id)
    const { client, sent } = recordingClient()
    await service.handleUpdate(update(`/start ${token}`), { secret: SECRET, client })

    expect(sent).toEqual([{ chatId: '777', text: BOT_REPLIES.linked }])
  })

  it('та же ссылка второй раз не срабатывает', async () => {
    mocks.findActiveUser.mockResolvedValue(manager)
    const { token } = createLinkToken(SECRET, manager.id)
    const { client, sent } = recordingClient()
    await service.handleUpdate(update(`/start ${token}`), { secret: SECRET, client })
    await service.handleUpdate(update(`/start ${token}`, { id: 888, type: 'private' }), { secret: SECRET, client })
    expect(mocks.linkChat).toHaveBeenCalledTimes(1)
    expect(sent[1]).toEqual({ chatId: '888', text: BOT_REPLIES.invalidToken })
  })

  it('токен заблокированного пользователя или подписанный не тем секретом — отказ', async () => {
    mocks.findActiveUser.mockResolvedValue(null)
    const { client, sent } = recordingClient()
    await service.handleUpdate(update(`/start ${createLinkToken(SECRET, manager.id).token}`), { secret: SECRET, client })
    await service.handleUpdate(update(`/start ${createLinkToken('другой', manager.id).token}`), { secret: SECRET, client })
    expect(mocks.linkChat).not.toHaveBeenCalled()
    expect(sent.map((item) => item.text)).toEqual([BOT_REPLIES.invalidToken, BOT_REPLIES.invalidToken])
  })

  it('в группе бот не работает: сводка о личных делах', async () => {
    const { client, sent } = recordingClient()
    await service.handleUpdate(update('/today', { id: -100, type: 'group' }), { secret: SECRET, client })
    expect(mocks.findActiveUserByChat).not.toHaveBeenCalled()
    expect(sent).toEqual([{ chatId: '-100', text: BOT_REPLIES.notPrivate }])
  })

  it('/today в неподключённом чате — подсказка, как подключить', async () => {
    mocks.findActiveUserByChat.mockResolvedValue(null)
    const { client, sent } = recordingClient()
    await service.handleUpdate(update('/today'), { secret: SECRET, client })
    expect(sent[0]!.text).toBe(BOT_REPLIES.notLinked)
  })

  it('/today в подключённом — сводка этого пользователя', async () => {
    mocks.findActiveUserByChat.mockResolvedValue(manager)
    const { client, sent } = recordingClient()
    await service.handleUpdate(update('/today'), { secret: SECRET, client })
    expect(mocks.findDigestStages).toHaveBeenCalledWith(manager.id, expect.any(Date), expect.any(Number))
    expect(sent[0]!.text).toContain('ничего не горит')
  })

  it('/stop отвязывает чат и пишет журнал', async () => {
    mocks.unlinkChat.mockResolvedValue(manager.id)
    const { client, sent } = recordingClient()
    await service.handleUpdate(update('/stop'), { secret: SECRET, client })
    expect(mocks.unlinkChat).toHaveBeenCalledWith('777')
    expect(sent[0]!.text).toBe(BOT_REPLIES.stopped)
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'telegram.unlink' }))
  })

  it('повтор того же update_id: отметка в базе, второй раз — false (решение 133)', async () => {
    expect(await service.acceptUpdate(9001)).toBe(true)
    expect(await service.acceptUpdate(9001)).toBe(false)
    expect(await service.acceptUpdate(9002)).toBe(true)
    expect(mocks.markUpdateSeen).toHaveBeenCalledWith(9001)
  })

  it('старые отметки чистятся раз в N вставок, сбой чистки не мешает приёму', async () => {
    mocks.purgeSeenUpdates.mockRejectedValue(new Error('база занята'))
    const now = new Date('2026-09-26T00:00:00Z')
    for (let id = 1; id <= 100; id += 1) await service.acceptUpdate(100_000 + id, now)
    expect(mocks.purgeSeenUpdates).toHaveBeenCalledTimes(1)
    expect(mocks.purgeSeenUpdates).toHaveBeenCalledWith(new Date('2026-09-19T00:00:00Z'))
  })

  it('сбой базы при отметке — исключение (маршрут ответит 500, Telegram повторит)', async () => {
    mocks.markUpdateSeen.mockRejectedValue(new Error('connection refused'))
    await expect(service.acceptUpdate(1)).rejects.toThrow()
  })

  it('сбой базы — короткий ответ, исключения наружу нет', async () => {
    mocks.findActiveUserByChat.mockRejectedValue(new Error('база недоступна'))
    const { client, sent } = recordingClient()
    await expect(service.handleUpdate(update('/today'), { secret: SECRET, client })).resolves.toBeUndefined()
    expect(sent[0]!.text).toBe(BOT_REPLIES.unavailable)
  })

  it('бот выключен — ничего не делает', async () => {
    mocks.telegram = enabledConfig({ botToken: null, enabled: false })
    const { client, sent } = recordingClient()
    await service.handleUpdate(update('/today'), { secret: SECRET, client })
    expect(sent).toHaveLength(0)
  })
})

describe('смена секрета вебхука (решение 133)', () => {
  const admin: CurrentUser = { ...manager, id: 'cmuser0admin00000000000000', role: 'ADMIN' }

  /** Клиент, чей setWebhook запоминает секрет вместо отправки в Telegram. */
  function webhookClient(result: Awaited<ReturnType<TelegramClient['setWebhook']>> = { ok: true }) {
    const calls: Array<{ url: string; secret: string }> = []
    const client = new TelegramClient(enabledConfig())
    vi.spyOn(client, 'setWebhook').mockImplementation(async (url, secret) => {
      calls.push({ url, secret })
      return result
    })
    return { client, calls }
  }

  beforeEach(() => vi.stubEnv('AUTH_URL', 'https://skilllink.test'))
  afterEach(() => vi.unstubAllEnvs())

  it('старый секрет — 403, новый — проходит; секрета нет ни в ответе, ни в журнале', async () => {
    const { client, calls } = webhookClient()
    await expect(service.assertWebhookSecret('hook')).resolves.toBeUndefined()

    const dto = await service.rotateWebhookSecret(admin, { client })

    expect(calls).toHaveLength(1)
    const secret = calls[0]!.secret
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(calls[0]!.url).toBe('https://skilllink.test/api/telegram/webhook')
    expect(dto).toEqual({ rotatedAt: '2026-09-26T10:00:00.000Z', webhookUrl: 'https://skilllink.test/api/telegram/webhook' })
    expect(JSON.stringify(dto)).not.toContain(secret)

    await expect(service.assertWebhookSecret('hook')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(service.assertWebhookSecret(secret)).resolves.toBeUndefined()

    // В базе — только хеш, в журнале — ни секрета, ни хеша.
    const [, storedHash] = mocks.saveSecretHash.mock.calls[0] as [string, string]
    expect(storedHash).toMatch(/^[0-9a-f]{64}$/)
    expect(storedHash).not.toContain(secret)
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'telegram.webhook_secret_rotated', userId: admin.id }),
    )
    const audit = JSON.stringify(mocks.writeAudit.mock.calls)
    expect(audit).not.toContain(secret)
    expect(audit).not.toContain(storedHash)
  })

  it('Telegram отказал — 502, в базу ничего, прежний секрет действует', async () => {
    const { client } = webhookClient({ ok: false, reason: 'failed', status: 400, description: 'bad webhook' })
    await expect(service.rotateWebhookSecret(admin, { client })).rejects.toMatchObject({ code: 'INTEGRATION_ERROR' })
    expect(mocks.saveSecretHash).not.toHaveBeenCalled()
    expect(mocks.writeAudit).not.toHaveBeenCalled()
    await expect(service.assertWebhookSecret('hook')).resolves.toBeUndefined()
  })

  it('не администратор — 403; бот не настроен или нет адреса стенда — 502 до Telegram', async () => {
    const { client, calls } = webhookClient()
    await expect(service.rotateWebhookSecret(manager, { client })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    mocks.telegram = enabledConfig({ botToken: null, enabled: false })
    await expect(service.rotateWebhookSecret(admin, { client })).rejects.toMatchObject({ code: 'INTEGRATION_ERROR' })
    mocks.telegram = enabledConfig()
    vi.stubEnv('AUTH_URL', '')
    vi.stubEnv('APP_BASE_URL', '')
    await expect(service.rotateWebhookSecret(admin, { client })).rejects.toMatchObject({ code: 'INTEGRATION_ERROR' })
    expect(calls).toHaveLength(0)
  })

  it('две смены подряд выполняются по очереди: в базе секрет последнего вызова Telegram', async () => {
    const { client, calls } = webhookClient()
    await Promise.all([service.rotateWebhookSecret(admin, { client }), service.rotateWebhookSecret(admin, { client })])
    expect(calls).toHaveLength(2)
    await expect(service.assertWebhookSecret(calls[1]!.secret)).resolves.toBeUndefined()
    await expect(service.assertWebhookSecret(calls[0]!.secret)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('рассылка', () => {
  const overdue = {
    stageId: 's-1',
    stageNumber: 6,
    stageTitle: 'Подписание документов',
    status: 'IN_PROGRESS' as const,
    deadline: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    cooperationId: 'c-1',
    universityName: 'СПбГУТ',
    programName: 'Программная инженерия',
    siblings: [],
  }

  it('пустые сводки не шлёт, представителю не шлёт, сбой одного не останавливает остальных', async () => {
    mocks.listActiveLinks
      .mockResolvedValueOnce([
        { id: 'l1', chatId: '1', user: manager },
        { id: 'l2', chatId: '2', user: { ...manager, id: 'm2' } },
        { id: 'l3', chatId: '3', user: rep },
        { id: 'l4', chatId: '4', user: { ...manager, id: 'm4' } },
      ])
      .mockResolvedValueOnce([])
    mocks.findDigestStages.mockImplementation(async (userId: string) => {
      if (userId === 'm2') return []
      if (userId === 'm4') throw new Error('сбой')
      return [overdue]
    })
    const { client, sent } = recordingClient()
    const summary = await service.sendDigests({ dryRun: false, client, wait: async () => {} })

    expect(summary).toEqual({ recipients: 4, sent: 1, empty: 1, skipped: 1, blocked: 0, failed: 1 })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.chatId).toBe('1')
    expect(sent[0]!.text).toContain('Просрочено — 1')
  })

  it('--dry-run только печатает: без почты и чата, в Telegram ничего не уходит', async () => {
    mocks.listActiveLinks.mockResolvedValueOnce([{ id: 'l1', chatId: '555', user: manager }]).mockResolvedValueOnce([])
    mocks.findDigestStages.mockResolvedValue([overdue])
    const printed: string[] = []
    const { client, sent } = recordingClient()
    const summary = await service.sendDigests({ dryRun: true, client, print: (line) => printed.push(line) })

    expect(sent).toHaveLength(0)
    expect(summary.sent).toBe(1)
    expect(printed.join('\n')).toContain('Просрочено — 1')
    expect(printed.join('\n')).not.toMatch(/manager@example\.test|555|Демо Менеджер/)
  })

  it('человек остановил бота — считается отдельно', async () => {
    mocks.listActiveLinks.mockResolvedValueOnce([{ id: 'l1', chatId: '1', user: manager }]).mockResolvedValueOnce([])
    mocks.findDigestStages.mockResolvedValue([overdue])
    const { client } = recordingClient({ ok: false, reason: 'blocked', status: 403 })
    const summary = await service.sendDigests({ dryRun: false, client, wait: async () => {} })
    expect(summary).toMatchObject({ sent: 0, blocked: 1 })
  })
})
