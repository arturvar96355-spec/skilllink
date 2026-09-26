import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BurstCounter,
  createOwnerNotifier,
  formatOwnerAlert,
  maskAddress,
  maskEmail,
  notifyOwner,
  type OwnerNotifierDeps,
} from './owner-alert'
import {
  alertLoginBlocked,
  alertUserChange,
  noteCaptchaRequired,
  noteExport,
  resetSecurityAlerts,
  setSecurityAlertSink,
} from './security-alerts'
import { OWNER_ALERT_BURSTS } from '@/shared/config/ops.config'

const NOW = Date.parse('2026-09-25T20:00:00Z')

function harness(overrides: Partial<OwnerNotifierDeps> = {}) {
  let clock = NOW
  const sent: Array<{ chat: string; text: string }> = []
  const lines: string[] = []
  const notifier = createOwnerNotifier({
    enabled: () => true,
    recipients: async () => ['111', '222', '111'],
    send: async (chat, text) => {
      sent.push({ chat, text })
      return { ok: true }
    },
    now: () => clock,
    log: (line) => lines.push(line),
    ...overrides,
  })
  return { notifier, sent, lines, advance: (ms: number) => (clock += ms) }
}

describe('маскирование', () => {
  it('почта: первая буква и зона, остальное скрыто', () => {
    expect(maskEmail('ivan.petrov@mail.ru')).toBe('i***@m***.ru')
    expect(maskEmail('admin@skilllink.demo')).toBe('a***@s***.demo')
    // В поле почты по ошибке вводят пароль — от него остаётся одна буква.
    expect(maskEmail('Pa$$w0rd')).toBe('P***')
  })

  it('адрес клиента — до сети', () => {
    expect(maskAddress('203.0.113.5')).toBe('203.0.*.*')
    expect(maskAddress('2001:db8:1::5')).toBe('2001:db8:*')
    expect(maskAddress('unknown')).toBe('unknown')
    expect(maskAddress('мусор в заголовке')).toBe('***')
  })

  it('в тексте сообщения нет ни почты, ни полного адреса — даже под чужим именем поля', () => {
    const text = formatOwnerAlert(
      'login.blocked',
      { details: { account: 'ivan.petrov@mail.ru', address: '203.0.113.5', note: 'писал petrov@corp.ru', counters: ['account'] } },
      new Date(NOW),
    )
    expect(text).not.toContain('ivan.petrov')
    expect(text).not.toContain('petrov@corp.ru')
    expect(text).not.toContain('113.5')
    expect(text).toContain('i***@m***.ru')
    expect(text).toContain('203.0.*.*')
    expect(text).toContain('Вход закрыт')
    expect(text).toContain('МСК')
  })
})

describe('отправка владельцу', () => {
  it('всем получателям по одному разу', async () => {
    const { notifier, sent, lines } = harness()
    notifier.notify('user.blocked', { key: 'u1', details: { userId: 'u1' } })
    await notifier.settled()
    expect(sent.map((item) => item.chat).sort()).toEqual(['111', '222'])
    expect(lines.at(-1)).toContain('отправлено 2 из 2')
  })

  it('то же событие с тем же ключом — не чаще раза в 15 минут', async () => {
    const { notifier, sent, advance } = harness({ recipients: async () => ['1'] })
    notifier.notify('login.blocked', { key: 'a' })
    notifier.notify('login.blocked', { key: 'a' })
    notifier.notify('login.blocked', { key: 'b' })
    advance(14 * 60_000)
    notifier.notify('login.blocked', { key: 'a' })
    await notifier.settled()
    expect(sent).toHaveLength(2)
    advance(2 * 60_000)
    notifier.notify('login.blocked', { key: 'a' })
    await notifier.settled()
    expect(sent).toHaveLength(3)
  })

  it('ни один канал не настроен — строка в журнале, отправки нет, не падает', async () => {
    const send = vi.fn()
    const { notifier, lines } = harness({ enabled: () => false, send })
    notifier.notify('export.bulk', { key: 'x' })
    await notifier.settled()
    expect(send).not.toHaveBeenCalled()
    expect(lines).toEqual(['[owner-alert] export.bulk: ни один канал не настроен (Telegram/MAX/VK) — не отправлено'])
  })

  it('никогда не бросает: ни сбой базы получателей, ни сбой отправки', async () => {
    const broken = harness({
      recipients: async () => {
        throw new Error('база недоступна')
      },
    })
    expect(() => broken.notifier.notify('user.blocked')).not.toThrow()
    await broken.notifier.settled()
    expect(broken.lines.at(-1)).toContain('не отправлено — сбой')

    const failing = harness({
      send: async () => {
        throw new Error('сеть')
      },
    })
    failing.notifier.notify('user.blocked')
    await failing.notifier.settled()
    expect(failing.lines.at(-1)).toContain('отправлено 0 из 2')

    const throwingSync = harness({
      enabled: () => {
        throw new Error('синхронно')
      },
    })
    expect(() => throwingSync.notifier.notify('user.blocked')).not.toThrow()
  })

  it('отправка ограничена по времени', async () => {
    const { notifier, lines } = harness({
      timeoutMs: 20,
      send: () => new Promise(() => undefined),
    })
    const started = Date.now()
    notifier.notify('user.role.admin')
    await notifier.settled()
    expect(Date.now() - started).toBeLessThan(1000)
    expect(lines.at(-1)).toContain('дольше 20 мс')
  })

  it('получателей нет — так и написано в журнале', async () => {
    const { notifier, lines } = harness({ recipients: async () => [] })
    notifier.notify('user.blocked')
    await notifier.settled()
    expect(lines.at(-1)).toContain('получателей нет')
  })

  it('возвращает управление сразу — вызывающий ничего не ждёт', () => {
    const { notifier } = harness({ send: () => new Promise(() => undefined), timeoutMs: 10 })
    expect(notifier.notify('user.blocked')).toBeUndefined()
  })

  it('экземпляр приложения без токена бота ничего не ломает', () => {
    expect(() => notifyOwner('user.blocked', { key: 'test' })).not.toThrow()
  })
})

describe('когда приложение зовёт владельца', () => {
  const events: Array<{ event: string; key?: string; details?: Record<string, unknown> }> = []
  afterEach(() => {
    events.length = 0
    setSecurityAlertSink(null)
    resetSecurityAlerts()
  })
  const capture = () => setSecurityAlertSink((event, payload) => events.push({ event, ...payload }))

  it('блокировка входа: по учётной записи — ключ учётной записи, по адресу — ключ адреса', () => {
    capture()
    alertLoginBlocked('a@b.ru', '1.2.3.4', [])
    alertLoginBlocked('a@b.ru', '1.2.3.4', ['account-address'])
    alertLoginBlocked('c@b.ru', '1.2.3.4', ['address'])
    expect(events.map((item) => [item.event, item.key])).toEqual([
      ['login.blocked', 'account:a@b.ru'],
      ['login.blocked', 'address:1.2.3.4'],
    ])
  })

  it('проверка «не робот»: одиночная — тишина, порог за окно — сообщение', () => {
    capture()
    const { threshold } = OWNER_ALERT_BURSTS.captcha
    for (let i = 1; i < threshold; i += 1) noteCaptchaRequired(NOW + i)
    expect(events).toHaveLength(0)
    noteCaptchaRequired(NOW + threshold)
    expect(events).toEqual([expect.objectContaining({ event: 'login.captcha-burst' })])
  })

  it('выгрузки: считаются по пользователю', () => {
    capture()
    const { threshold } = OWNER_ALERT_BURSTS.exportsPerUser
    for (let i = 0; i < threshold - 1; i += 1) noteExport('u1', 'universities', 10, NOW + i)
    noteExport('u2', 'universities', 10, NOW)
    expect(events).toHaveLength(0)
    noteExport('u1', 'programs', 50, NOW + threshold)
    expect(events).toEqual([expect.objectContaining({ event: 'export.bulk', key: 'u1' })])
  })

  it('блокировка и выдача роли администратора; разблокировка и прочие роли — тишина', () => {
    capture()
    alertUserChange('actor', 'u1', { role: 'MANAGER', isActive: true }, { role: 'MANAGER', isActive: false })
    alertUserChange('actor', 'u2', { role: 'MANAGER', isActive: true }, { role: 'ADMIN', isActive: true })
    alertUserChange('actor', 'u3', null, { role: 'ADMIN', isActive: true })
    alertUserChange('actor', 'u4', { role: 'MANAGER', isActive: false }, { role: 'MANAGER', isActive: true })
    alertUserChange('actor', 'u5', { role: 'ADMIN', isActive: true }, { role: 'ADMIN', isActive: true })
    alertUserChange('actor', 'u6', null, { role: 'VIEWER', isActive: true })
    expect(events.map((item) => [item.event, item.key])).toEqual([
      ['user.blocked', 'u1'],
      ['user.role.admin', 'u2'],
      ['user.role.admin', 'u3'],
    ])
  })
})

describe('счётчик всплесков', () => {
  it('скользящее окно', () => {
    const counter = new BurstCounter(1000)
    expect(counter.hit('k', 0)).toBe(1)
    expect(counter.hit('k', 500)).toBe(2)
    expect(counter.hit('k', 1200)).toBe(2)
    expect(counter.hit('k', 5000)).toBe(1)
  })
})
