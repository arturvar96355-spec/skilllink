import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Цикл приёма без вебхука (решение 142): long polling и auto-переключение.
 * Сети нет — `TelegramClient` подменён самодельным классом, который отдаёт
 * ответы из очереди и «зависает» (как настоящий long poll), пока не придёт
 * сигнал прерывания — так проверяется и обработка обновлений, и быстрая
 * остановка по `stop()` (решение 118: аккуратно по SIGTERM).
 */

type GetUpdatesResult =
  | { ok: true; updates: unknown[] }
  | { ok: false; reason: 'failed' | 'aborted'; status: number | null; description: string | null }
type WebhookInfoResult =
  | { ok: true; info: { url: string; pendingUpdateCount: number; lastErrorDate: Date | null; lastErrorMessage: string | null } }
  | { ok: false; reason: 'failed'; status: number | null }

const mocks = vi.hoisted(() => ({
  config: {
    botToken: '1:T',
    botUsername: 'skilllink_bot',
    webhookSecret: 'hook',
    apiBase: 'https://api.telegram.org',
    apiIp: null,
    timeoutMs: 1000,
    enabled: true,
    mode: 'auto' as 'webhook' | 'polling' | 'auto',
  },
  getUpdatesQueue: [] as GetUpdatesResult[],
  getUpdatesCalls: [] as Array<{ offset?: number }>,
  webhookInfoQueue: [] as WebhookInfoResult[],
  deleteWebhookCalls: 0,
  acceptUpdate: vi.fn(async () => true),
  handleUpdate: vi.fn(async () => undefined),
  writeAudit: vi.fn(async () => undefined),
  notifyOwner: vi.fn(),
}))

class FakeTelegramClient {
  async deleteWebhook() {
    mocks.deleteWebhookCalls += 1
    return { ok: true as const }
  }

  async getUpdates(options: { offset?: number; timeoutSec: number; signal?: AbortSignal }): Promise<GetUpdatesResult> {
    mocks.getUpdatesCalls.push({ offset: options.offset })
    const next = mocks.getUpdatesQueue.shift()
    if (next) return next
    // Как настоящий long poll: висит, пока Telegram не ответит или запрос не прервут.
    return new Promise((resolve) => {
      options.signal?.addEventListener(
        'abort',
        () => resolve({ ok: false, reason: 'aborted', status: null, description: null }),
        { once: true },
      )
    })
  }

  async getWebhookInfo(): Promise<WebhookInfoResult> {
    return mocks.webhookInfoQueue.shift() ?? { ok: false, reason: 'failed', status: null }
  }

  async sendMessage() {
    return { ok: true as const }
  }
}

vi.mock('@/integrations/telegram', () => ({ TelegramClient: FakeTelegramClient }))
vi.mock('@/integrations/telegram/runtime-config', () => ({
  effectiveTelegramConfig: () => mocks.config,
  TELEGRAM_MODE_SECRET_NAME: 'telegram.mode',
}))
vi.mock('./telegram.service', () => ({ acceptUpdate: mocks.acceptUpdate, handleUpdate: mocks.handleUpdate }))
vi.mock('@/shared/audit/audit', () => ({ writeAudit: mocks.writeAudit }))
vi.mock('@/shared/ops/owner-alert', () => ({ notifyOwner: mocks.notifyOwner }))

const runtime = await import('./telegram.runtime')

beforeEach(() => {
  mocks.config = {
    botToken: '1:T',
    botUsername: 'skilllink_bot',
    webhookSecret: 'hook',
    apiBase: 'https://api.telegram.org',
    apiIp: null,
    timeoutMs: 1000,
    enabled: true,
    mode: 'auto',
  }
  mocks.getUpdatesQueue = []
  mocks.getUpdatesCalls = []
  mocks.webhookInfoQueue = []
  mocks.deleteWebhookCalls = 0
  mocks.acceptUpdate.mockReset().mockResolvedValue(true)
  mocks.handleUpdate.mockReset().mockResolvedValue(undefined)
  mocks.writeAudit.mockReset()
  mocks.notifyOwner.mockReset()
  runtime.resetRuntimeForTests()
})

afterEach(async () => {
  await runtime.stop()
  vi.useRealTimers()
})

describe('startPollingLoop / stopPollingLoop', () => {
  it('снимает вебхук перед первым запросом', async () => {
    await runtime.startPollingLoop('secret')
    expect(mocks.deleteWebhookCalls).toBe(1)
  })

  it('обрабатывает обновления через service.acceptUpdate/handleUpdate и растит offset', async () => {
    mocks.getUpdatesQueue.push({ ok: true, updates: [{ update_id: 5, message: { chat: { id: 1, type: 'private' } } }] })
    await runtime.startPollingLoop('secret')
    await vi.waitFor(() => expect(mocks.handleUpdate).toHaveBeenCalledTimes(1))
    expect(mocks.acceptUpdate).toHaveBeenCalledWith(5)
    expect(mocks.handleUpdate).toHaveBeenCalledWith({ update_id: 5, message: { chat: { id: 1, type: 'private' } } }, { secret: 'secret' })
    // Следующий запрос — уже со сдвинутым offset.
    await vi.waitFor(() => expect(mocks.getUpdatesCalls.length).toBeGreaterThanOrEqual(2))
    expect(mocks.getUpdatesCalls[1]).toEqual({ offset: 6 })
  })

  it('повтор (acceptUpdate вернул false) обрабатывается не второй раз', async () => {
    mocks.acceptUpdate.mockResolvedValue(false)
    mocks.getUpdatesQueue.push({ ok: true, updates: [{ update_id: 9, message: { chat: { id: 1, type: 'private' } } }] })
    await runtime.startPollingLoop('secret')
    await vi.waitFor(() => expect(mocks.acceptUpdate).toHaveBeenCalledTimes(1))
    expect(mocks.handleUpdate).not.toHaveBeenCalled()
  })

  it('stop() прерывает висящий getUpdates быстро, а не ждёт таймаута Telegram', async () => {
    await runtime.startPollingLoop('secret')
    await vi.waitFor(() => expect(mocks.getUpdatesCalls.length).toBeGreaterThanOrEqual(1))
    const startedAt = Date.now()
    await runtime.stop()
    expect(Date.now() - startedAt).toBeLessThan(1000)
    expect(runtime.getRuntimeStatus().running).toBe('off')
  })

  it('дважды подряд start ничего не ломает: второй вызов — no-op', async () => {
    await runtime.startPollingLoop('secret')
    await runtime.startPollingLoop('secret')
    expect(mocks.deleteWebhookCalls).toBe(1)
  })
})

describe('checkAutoMode', () => {
  it('вебхук здоров — polling не запускается', async () => {
    mocks.webhookInfoQueue.push({
      ok: true,
      info: { url: 'https://x/api/telegram/webhook', pendingUpdateCount: 0, lastErrorDate: null, lastErrorMessage: null },
    })
    await runtime.checkAutoMode('secret')
    expect(runtime.getRuntimeStatus().running).not.toBe('polling')
    expect(mocks.writeAudit).not.toHaveBeenCalled()
    expect(mocks.notifyOwner).not.toHaveBeenCalled()
  })

  it('свежая ошибка вебхука (<10 мин) — переключение на polling, журнал и оповещение владельцу', async () => {
    mocks.webhookInfoQueue.push({
      ok: true,
      info: {
        url: 'https://x/api/telegram/webhook',
        pendingUpdateCount: 1,
        lastErrorDate: new Date(Date.now() - 60_000),
        lastErrorMessage: 'Connection timed out',
      },
    })
    await runtime.checkAutoMode('secret')
    await vi.waitFor(() => expect(mocks.deleteWebhookCalls).toBe(1))
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'telegram.mode_switched', payload: expect.objectContaining({ by: 'auto', to: 'polling' }) }),
    )
    expect(mocks.notifyOwner).toHaveBeenCalledWith('telegram.auto-switched-to-polling', expect.anything())
  })

  it('старая ошибка (>10 мин) и стабильный pending — не переключается', async () => {
    mocks.webhookInfoQueue.push({
      ok: true,
      info: {
        url: 'https://x/api/telegram/webhook',
        pendingUpdateCount: 2,
        lastErrorDate: new Date(Date.now() - 20 * 60_000),
        lastErrorMessage: 'давняя ошибка',
      },
    })
    await runtime.checkAutoMode('secret')
    mocks.webhookInfoQueue.push({
      ok: true,
      info: {
        url: 'https://x/api/telegram/webhook',
        pendingUpdateCount: 2,
        lastErrorDate: new Date(Date.now() - 20 * 60_000),
        lastErrorMessage: 'давняя ошибка',
      },
    })
    await runtime.checkAutoMode('secret')
    expect(mocks.deleteWebhookCalls).toBe(0)
  })

  it('необработанных обновлений становится больше между проверками — переключение', async () => {
    mocks.webhookInfoQueue.push({
      ok: true,
      info: { url: 'https://x', pendingUpdateCount: 1, lastErrorDate: null, lastErrorMessage: null },
    })
    await runtime.checkAutoMode('secret')
    expect(mocks.deleteWebhookCalls).toBe(0)

    mocks.webhookInfoQueue.push({
      ok: true,
      info: { url: 'https://x', pendingUpdateCount: 5, lastErrorDate: null, lastErrorMessage: null },
    })
    await runtime.checkAutoMode('secret')
    await vi.waitFor(() => expect(mocks.deleteWebhookCalls).toBe(1))
  })

  it('режим не auto — проверка ничего не делает', async () => {
    mocks.config = { ...mocks.config, mode: 'webhook' }
    mocks.webhookInfoQueue.push({
      ok: true,
      info: { url: 'https://x', pendingUpdateCount: 1, lastErrorDate: new Date(), lastErrorMessage: 'x' },
    })
    await runtime.checkAutoMode('secret')
    expect(mocks.deleteWebhookCalls).toBe(0)
  })
})

describe('start / stop (instrumentation.ts)', () => {
  it('mode=webhook — ничего не запускает', async () => {
    mocks.config = { ...mocks.config, mode: 'webhook' }
    await runtime.start('secret')
    expect(mocks.deleteWebhookCalls).toBe(0)
    expect(runtime.getRuntimeStatus().running).toBe('off')
  })

  it('mode=polling — сразу запускает цикл', async () => {
    mocks.config = { ...mocks.config, mode: 'polling' }
    await runtime.start('secret')
    expect(mocks.deleteWebhookCalls).toBe(1)
  })

  it('бот не настроен (enabled=false) — ничего не запускает даже в polling', async () => {
    mocks.config = { ...mocks.config, enabled: false, mode: 'polling' }
    await runtime.start('secret')
    expect(mocks.deleteWebhookCalls).toBe(0)
  })

  it('mode=auto — проверяет сразу при старте (без ожидания 5 минут)', async () => {
    mocks.webhookInfoQueue.push({
      ok: true,
      info: { url: 'https://x', pendingUpdateCount: 0, lastErrorDate: null, lastErrorMessage: null },
    })
    await runtime.start('secret')
    expect(runtime.getRuntimeStatus().lastAutoCheckAt).not.toBeNull()
  })

  it('stop() останавливает и цикл, и таймер auto-проверки', async () => {
    mocks.config = { ...mocks.config, mode: 'polling' }
    await runtime.start('secret')
    await runtime.stop()
    expect(runtime.getRuntimeStatus().running).toBe('off')
  })
})
