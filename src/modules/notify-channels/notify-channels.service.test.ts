import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { MaxConfig, VkConfig } from '@/integrations/config'

/**
 * Сервис каналов уведомлений (решение 144): привязка, перепривязка, отключение,
 * команды входящих MAX/VK, выбор канала для отправки. База, MAX и VK подменены —
 * проверяется, что сервис пишет в базу/журнал и что отвечает боту.
 */

const mocks = vi.hoisted(() => ({
  findLinksByUser: vi.fn(),
  findChatRef: vi.fn(),
  getPrimaryChannel: vi.fn(),
  setPrimaryChannel: vi.fn(),
  linkAltChannel: vi.fn(),
  unlinkAltChannel: vi.fn(),
  findUserIdByChatRef: vi.fn(),
  findActiveUserByChatRef: vi.fn(),
  findActiveUser: vi.fn(),
  listDigestRecipients: vi.fn(),
  listAdminRecipientIds: vi.fn(),
  countLinks: vi.fn(),
  writeAudit: vi.fn(),
  telegramConnect: vi.fn(),
  telegramDisconnect: vi.fn(),
  digestFor: vi.fn(),
  max: null as MaxConfig | null,
  vk: null as VkConfig | null,
  maxSend: vi.fn(),
  vkSend: vi.fn(),
}))

vi.mock('./notify-channels.repo', () => ({
  findLinksByUser: mocks.findLinksByUser,
  findChatRef: mocks.findChatRef,
  getPrimaryChannel: mocks.getPrimaryChannel,
  setPrimaryChannel: mocks.setPrimaryChannel,
  linkAltChannel: mocks.linkAltChannel,
  unlinkAltChannel: mocks.unlinkAltChannel,
  findUserIdByChatRef: mocks.findUserIdByChatRef,
  findActiveUserByChatRef: mocks.findActiveUserByChatRef,
  findActiveUser: mocks.findActiveUser,
  listDigestRecipients: mocks.listDigestRecipients,
  listAdminRecipientIds: mocks.listAdminRecipientIds,
  countLinks: mocks.countLinks,
  markUpdateSeen: vi.fn(async () => true),
  purgeSeenUpdates: vi.fn(async () => 0),
}))
vi.mock('@/shared/audit/audit', () => ({ writeAudit: mocks.writeAudit }))
vi.mock('@/modules/telegram/telegram.service', () => ({
  connect: mocks.telegramConnect,
  disconnect: mocks.telegramDisconnect,
  digestFor: mocks.digestFor,
}))
vi.mock('@/integrations/config', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/integrations/config')>()
  return {
    ...original,
    getIntegrationsConfig: () => ({ ...original.getIntegrationsConfig(), max: mocks.max, vk: mocks.vk }),
  }
})
vi.mock('@/integrations/max', () => ({ getMaxClient: () => ({ enabled: mocks.max?.enabled ?? false, sendMessage: mocks.maxSend }) }))
vi.mock('@/integrations/vk', () => ({ getVkClient: () => ({ enabled: mocks.vk?.enabled ?? false, sendMessage: mocks.vkSend }) }))

const service = await import('./notify-channels.service')

function maxConfig(overrides: Partial<MaxConfig> = {}): MaxConfig {
  return {
    botToken: 'tok',
    botUsername: 'skilllink_max_bot',
    webhookSecret: 'wh',
    apiBase: 'https://platform-api2.max.ru',
    timeoutMs: 1000,
    enabled: true,
    ...overrides,
  }
}
function vkConfig(overrides: Partial<VkConfig> = {}): VkConfig {
  return {
    groupToken: 'tok',
    groupId: '1',
    confirmationCode: 'code',
    secret: 'sec',
    apiBase: 'https://api.vk.com/method',
    apiVersion: '5.199',
    timeoutMs: 1000,
    enabled: true,
    ...overrides,
  }
}

const manager: CurrentUser = { id: 'u-manager', email: 'm@example.test', fullName: 'Менеджер', role: 'MANAGER', universityId: null }
const rep: CurrentUser = { id: 'u-rep', email: 'r@example.test', fullName: 'Вуз', role: 'UNIVERSITY_REP', universityId: 'uni-1' }

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.max = null
  mocks.vk = null
  mocks.findLinksByUser.mockResolvedValue([])
  mocks.getPrimaryChannel.mockResolvedValue(null)
  const { resetSpentLinkCodes } = await import('./notify-channels.link-token')
  resetSpentLinkCodes()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('getChannels', () => {
  it('три канала, каждый со своим configured; основной — первый настроенный и привязанный', async () => {
    mocks.max = maxConfig()
    mocks.findLinksByUser.mockResolvedValue([{ channel: 'max', chatRef: '42', username: 'ivan', linkedAt: new Date('2026-09-25T00:00:00Z') }])
    const result = await service.getChannels(manager)
    expect(result).toHaveLength(3)
    const max = result.find((r) => r.id === 'max')!
    expect(max).toMatchObject({ configured: true, linked: true, username: 'ivan', primary: true })
    expect(result.find((r) => r.id === 'telegram')).toMatchObject({ configured: false, linked: false, primary: false })
    expect(result.find((r) => r.id === 'vk')).toMatchObject({ configured: false, linked: false, primary: false })
  })
})

describe('connect', () => {
  it('канал не настроен — 502 INTEGRATION_ERROR', async () => {
    await expect(service.connect(manager, 'max', 'secret')).rejects.toMatchObject({ code: 'INTEGRATION_ERROR' })
  })

  it('канал настроен — отдаёт диплинк с кодом и срок', async () => {
    mocks.max = maxConfig()
    const result = await service.connect(manager, 'max', 'secret', Date.parse('2026-09-26T10:00:00Z'))
    expect(result.url).toMatch(/^https:\/\/max\.ru\/skilllink_max_bot\/start\/.+/)
    expect(result.expiresAt).toBe('2026-09-26T10:15:00.000Z')
  })

  it('vk — отдаёт ссылку vk.me/club<id>?ref=<код>', async () => {
    mocks.vk = vkConfig()
    const result = await service.connect(manager, 'vk', 'secret')
    expect(result.url).toMatch(/^https:\/\/vk\.me\/club1\?ref=.+/)
  })

  it('telegram — делегирует в telegram.service.connect (публичная функция)', async () => {
    mocks.telegramConnect.mockReturnValue({ url: 'https://t.me/bot?start=x', expiresAt: '2026-09-26T10:15:00.000Z' })
    const result = await service.connect(manager, 'telegram', 'secret')
    expect(mocks.telegramConnect).toHaveBeenCalledWith(manager, 'secret', expect.anything())
    expect(result.url).toBe('https://t.me/bot?start=x')
  })

  it('представителю вуза — 403 (нет права ANALYTICS)', async () => {
    mocks.max = maxConfig()
    await expect(service.connect(rep, 'max', 'secret')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('disconnect / setPrimary', () => {
  it('отключает alt-канал и пишет в журнал только если привязка была', async () => {
    mocks.unlinkAltChannel.mockResolvedValueOnce(true)
    await service.disconnect(manager, 'max')
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'channel.unlink', payload: { channel: 'max', source: 'profile' } }))

    mocks.writeAudit.mockClear()
    mocks.unlinkAltChannel.mockResolvedValueOnce(false)
    await service.disconnect(manager, 'vk')
    expect(mocks.writeAudit).not.toHaveBeenCalled()
  })

  it('telegram — делегирует в telegram.service.disconnect', async () => {
    await service.disconnect(manager, 'telegram')
    expect(mocks.telegramDisconnect).toHaveBeenCalledWith(manager)
  })

  it('setPrimary сохраняет выбор и null сбрасывает на автоматический', async () => {
    await service.setPrimary(manager, 'vk')
    expect(mocks.setPrimaryChannel).toHaveBeenCalledWith(manager.id, 'vk')
    await service.setPrimary(manager, null)
    expect(mocks.setPrimaryChannel).toHaveBeenCalledWith(manager.id, null)
  })
})

describe('handleInbound — привязка по коду', () => {
  it('верный код: привязывает, пишет журнал, отвечает "Готово"', async () => {
    mocks.max = maxConfig()
    const secret = 'secret'
    const { createLinkCode } = await import('./notify-channels.link-token')
    const now = new Date('2026-09-26T10:00:00Z')
    const { code } = createLinkCode(secret, manager.id, 'max', now.getTime())
    mocks.findActiveUser.mockResolvedValue(manager)
    mocks.linkAltChannel.mockResolvedValue({ previousChatRef: null })

    await service.handleInbound('max', { chatRef: '777', code, username: 'ivan' }, secret, now)

    expect(mocks.linkAltChannel).toHaveBeenCalledWith(manager.id, 'max', '777', 'ivan')
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'channel.link' }))
    expect(mocks.maxSend).toHaveBeenCalledWith('777', expect.stringContaining('Готово'))
  })

  it('перепривязка: старый чат получает «уведомления перенесены»', async () => {
    mocks.max = maxConfig()
    const secret = 'secret'
    const { createLinkCode } = await import('./notify-channels.link-token')
    const now = new Date('2026-09-26T10:00:00Z')
    const { code } = createLinkCode(secret, manager.id, 'max', now.getTime())
    mocks.findActiveUser.mockResolvedValue(manager)
    mocks.linkAltChannel.mockResolvedValue({ previousChatRef: 'old-chat' })

    await service.handleInbound('max', { chatRef: 'new-chat', code }, secret, now)

    expect(mocks.maxSend).toHaveBeenCalledWith('old-chat', expect.stringContaining('перенесены'))
    expect(mocks.maxSend).toHaveBeenCalledWith('new-chat', expect.stringContaining('Готово'))
  })

  it('недействительный код — отвечает, что ссылка устарела, ничего не привязывает', async () => {
    mocks.max = maxConfig()
    await service.handleInbound('max', { chatRef: '777', code: 'garbage' }, 'secret')
    expect(mocks.linkAltChannel).not.toHaveBeenCalled()
    expect(mocks.maxSend).toHaveBeenCalledWith('777', expect.stringContaining('недействительна'))
  })

  it('код для другого канала не проходит (max-код не годится для vk)', async () => {
    mocks.vk = vkConfig()
    const secret = 'secret'
    const { createLinkCode } = await import('./notify-channels.link-token')
    const { code } = createLinkCode(secret, manager.id, 'max', Date.now())
    await service.handleInbound('vk', { chatRef: '777', code }, secret)
    expect(mocks.linkAltChannel).not.toHaveBeenCalled()
    expect(mocks.vkSend).toHaveBeenCalledWith('777', expect.stringContaining('недействительна'))
  })
})

describe('handleInbound — команды', () => {
  it('«сегодня»: находит пользователя по чату и отвечает сводкой', async () => {
    mocks.max = maxConfig()
    mocks.findActiveUserByChatRef.mockResolvedValue(manager)
    mocks.digestFor.mockResolvedValue({ text: 'Ничего не горит', isEmpty: true })
    await service.handleInbound('max', { chatRef: '777', command: 'today' }, 'secret')
    expect(mocks.maxSend).toHaveBeenCalledWith('777', 'Ничего не горит')
  })

  it('«сегодня» без привязки — «не привязан»', async () => {
    mocks.max = maxConfig()
    mocks.findActiveUserByChatRef.mockResolvedValue(null)
    await service.handleInbound('max', { chatRef: '777', command: 'today' }, 'secret')
    expect(mocks.maxSend).toHaveBeenCalledWith('777', expect.stringContaining('не привязан'))
  })

  it('«стоп»: отвязывает чат и пишет журнал', async () => {
    mocks.max = maxConfig()
    mocks.findUserIdByChatRef.mockResolvedValue(manager.id)
    await service.handleInbound('max', { chatRef: '777', command: 'stop' }, 'secret')
    expect(mocks.unlinkAltChannel).toHaveBeenCalledWith(manager.id, 'max')
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'channel.unlink' }))
    expect(mocks.maxSend).toHaveBeenCalledWith('777', expect.stringContaining('остановлены'))
  })

  it('нераспознанное — справка', async () => {
    mocks.max = maxConfig()
    await service.handleInbound('max', { chatRef: '777', command: 'unknown' }, 'secret')
    expect(mocks.maxSend).toHaveBeenCalledWith('777', expect.stringContaining('Команды'))
  })

  it('ignored — ничего не отправляет', async () => {
    mocks.max = maxConfig()
    await service.handleInbound('max', { chatRef: '777', ignored: true }, 'secret')
    expect(mocks.maxSend).not.toHaveBeenCalled()
  })
})

describe('sendToUser', () => {
  it('без привязок — не отправлено', async () => {
    mocks.findLinksByUser.mockResolvedValue([])
    expect(await service.sendToUser('u1', 'текст')).toEqual({ sent: false, channel: null })
  })

  it('шлёт через основной канал', async () => {
    mocks.max = maxConfig()
    mocks.vk = vkConfig()
    mocks.findLinksByUser.mockResolvedValue([
      { channel: 'max', chatRef: '1', username: null, linkedAt: new Date() },
      { channel: 'vk', chatRef: '2', username: null, linkedAt: new Date() },
    ])
    mocks.getPrimaryChannel.mockResolvedValue('vk')
    mocks.vkSend.mockResolvedValue({ ok: true })
    const result = await service.sendToUser('u1', 'текст')
    expect(result).toEqual({ sent: true, channel: 'vk' })
    expect(mocks.vkSend).toHaveBeenCalledWith('2', 'текст')
    expect(mocks.maxSend).not.toHaveBeenCalled()
  })

  it('основной канал не смог доставить — переходит на следующий привязанный', async () => {
    mocks.max = maxConfig()
    mocks.vk = vkConfig()
    mocks.findLinksByUser.mockResolvedValue([
      { channel: 'max', chatRef: '1', username: null, linkedAt: new Date() },
      { channel: 'vk', chatRef: '2', username: null, linkedAt: new Date() },
    ])
    mocks.getPrimaryChannel.mockResolvedValue('vk')
    mocks.vkSend.mockResolvedValue({ ok: false, reason: 'blocked' })
    mocks.maxSend.mockResolvedValue({ ok: true })
    const result = await service.sendToUser('u1', 'текст')
    expect(result).toEqual({ sent: true, channel: 'max' })
  })
})

describe('ownerRecipientKeys / dispatchToRecipientKey', () => {
  it('собирает ключи "канал:чат" по основному каналу администраторов + TELEGRAM_OWNER_CHAT_ID', async () => {
    process.env.TELEGRAM_OWNER_CHAT_ID = '999'
    mocks.listAdminRecipientIds.mockResolvedValue(['admin-1'])
    mocks.findLinksByUser.mockResolvedValue([{ channel: 'vk', chatRef: '5', username: null, linkedAt: new Date() }])
    mocks.getPrimaryChannel.mockResolvedValue(null)
    const keys = await service.ownerRecipientKeys()
    expect(keys).toEqual(['telegram:999', 'vk:5'])
    delete process.env.TELEGRAM_OWNER_CHAT_ID
  })

  it('dispatchToRecipientKey разбирает ключ и шлёт через нужный адаптер', async () => {
    mocks.vk = vkConfig()
    mocks.vkSend.mockResolvedValue({ ok: true })
    expect(await service.dispatchToRecipientKey('vk:5', 'текст')).toEqual({ ok: true })
    expect(mocks.vkSend).toHaveBeenCalledWith('5', 'текст')
  })
})

describe('adminStatus / testChannel', () => {
  it('только администратору', async () => {
    await expect(service.adminStatus(manager)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('testChannel: канал не настроен — {ok:false}, не ошибка', async () => {
    const admin: CurrentUser = { ...manager, role: 'ADMIN' }
    const result = await service.testChannel(admin, 'max')
    expect(result).toEqual({ ok: false, reason: 'Канал не настроен администратором' })
  })

  it('testChannel: администратор не привязан себе — 403', async () => {
    mocks.max = maxConfig()
    mocks.findChatRef.mockResolvedValue(null)
    const admin: CurrentUser = { ...manager, role: 'ADMIN' }
    await expect(service.testChannel(admin, 'max')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('sendDigests', () => {
  it('получатель с привязкой MAX и без роли ANALYTICS — пропущен, не отправлено', async () => {
    mocks.listDigestRecipients.mockResolvedValueOnce([{ user: rep }]).mockResolvedValueOnce([])
    const summary = await service.sendDigests({ dryRun: false })
    expect(summary).toEqual({ recipients: 1, sent: 0, empty: 0, skipped: 1, failed: 0 })
    expect(mocks.digestFor).not.toHaveBeenCalled()
  })

  it('пустая сводка не отправляется', async () => {
    mocks.listDigestRecipients.mockResolvedValueOnce([{ user: manager }]).mockResolvedValueOnce([])
    mocks.digestFor.mockResolvedValue({ text: '', isEmpty: true })
    const summary = await service.sendDigests({ dryRun: false })
    expect(summary).toEqual({ recipients: 1, sent: 0, empty: 1, skipped: 0, failed: 0 })
  })

  it('непустая сводка уходит через sendToUser (основной канал получателя)', async () => {
    mocks.max = maxConfig()
    mocks.listDigestRecipients.mockResolvedValueOnce([{ user: manager }]).mockResolvedValueOnce([])
    mocks.digestFor.mockResolvedValue({ text: 'Просрочен этап 3', isEmpty: false })
    mocks.findLinksByUser.mockResolvedValue([{ channel: 'max', chatRef: '1', username: null, linkedAt: new Date() }])
    mocks.maxSend.mockResolvedValue({ ok: true })
    const summary = await service.sendDigests({ dryRun: false })
    expect(summary).toEqual({ recipients: 1, sent: 1, empty: 0, skipped: 0, failed: 0 })
    expect(mocks.maxSend).toHaveBeenCalledWith('1', 'Просрочен этап 3')
  })

  it('dry-run печатает и считает как отправленное, никуда не шлёт', async () => {
    mocks.listDigestRecipients.mockResolvedValueOnce([{ user: manager }]).mockResolvedValueOnce([])
    mocks.digestFor.mockResolvedValue({ text: 'Просрочен этап 3', isEmpty: false })
    const printed: string[] = []
    const summary = await service.sendDigests({ dryRun: true, print: (line) => printed.push(line) })
    expect(summary.sent).toBe(1)
    expect(printed.join('\n')).toContain('Просрочен этап 3')
    expect(mocks.maxSend).not.toHaveBeenCalled()
    expect(mocks.vkSend).not.toHaveBeenCalled()
  })
})
