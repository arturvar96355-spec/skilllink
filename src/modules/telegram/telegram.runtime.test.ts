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
  webhookInfoCalls: 0,
  deleteWebhookCalls: 0,
  acceptUpdate: vi.fn(async (_updateId: number) => true),
  handleUpdate: vi.fn(async () => undefined),
  writeAudit: vi.fn(async () => undefined),
  notifyOwner: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
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
    mocks.webhookInfoCalls += 1
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
vi.mock('@/shared/log/logger', () => ({
  log: { warn: mocks.logWarn, info: mocks.logInfo, error: mocks.logError },
}))

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
  mocks.webhookInfoCalls = 0
  mocks.deleteWebhookCalls = 0
  mocks.acceptUpdate.mockReset().mockResolvedValue(true)
  mocks.handleUpdate.mockReset().mockResolvedValue(undefined)
  mocks.writeAudit.mockReset()
  mocks.notifyOwner.mockReset()
  mocks.logWarn.mockReset()
  mocks.logInfo.mockReset()
  mocks.logError.mockReset()
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

  it('нажатие кнопки (callback_query) идёт тем же путём, повтор того же update_id — не второй раз (решение 200)', async () => {
    const press = {
      update_id: 11,
      callback_query: {
        id: 'cb-1',
        from: { id: 1 },
        message: { message_id: 3, chat: { id: 1, type: 'private' }, text: 'Сводка' },
        data: 'as' + 'A'.repeat(20) + 'cmstage0000000000000000001',
      },
    }
    const seen = new Set<number>()
    mocks.acceptUpdate.mockImplementation(async (id: number) => (seen.has(id) ? false : (seen.add(id), true)))
    // Telegram прислал то же нажатие дважды (например, после переключения режима).
    mocks.getUpdatesQueue.push({ ok: true, updates: [press] }, { ok: true, updates: [press] })
    await runtime.startPollingLoop('secret')
    await vi.waitFor(() => expect(mocks.acceptUpdate).toHaveBeenCalledTimes(2))
    expect(mocks.handleUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.handleUpdate).toHaveBeenCalledWith(expect.objectContaining({ update_id: 11, callback_query: expect.objectContaining({ id: 'cb-1' }) }), {
      secret: 'secret',
    })
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

  it('сетевой сбой getUpdates — пауза перед следующей попыткой, не тесный цикл без остановки', async () => {
    // Регрессия: без паузы на «сеть недоступна» (не «нас прервали») цикл колотился
    // по кругу без задержки — тысячи попыток и строк в журнал за секунды
    // (обнаружено на сборке: реальный ECONNREFUSED дал мегабайты журнала за ~2 с).
    vi.useFakeTimers()
    try {
      mocks.getUpdatesQueue.push({ ok: false, reason: 'failed', status: null, description: 'connect ECONNREFUSED' })
      mocks.getUpdatesQueue.push({ ok: false, reason: 'failed', status: null, description: 'connect ECONNREFUSED' })
      await runtime.startPollingLoop('secret')
      await vi.waitFor(() => expect(mocks.getUpdatesCalls.length).toBeGreaterThanOrEqual(1))

      const afterFirstFailure = mocks.getUpdatesCalls.length
      // Без продвижения таймеров вторая попытка не должна была уже случиться —
      // цикл обязан ждать паузу (даже минимальную ~1 с с разбросом), а не звать getUpdates немедленно.
      await Promise.resolve()
      expect(mocks.getUpdatesCalls.length).toBe(afterFirstFailure)

      // Первая пауза — около 1 с (0.8–1.2 с с разбросом): 2.5 с заведомо достаточно.
      await vi.advanceTimersByTimeAsync(2_500)
      await vi.waitFor(() => expect(mocks.getUpdatesCalls.length).toBeGreaterThan(afterFirstFailure))
    } finally {
      vi.useRealTimers()
    }
  })

  it('нарастающая пауза: 1 → 2 → 4 с при подряд идущих сбоях, а не фиксированная задержка', async () => {
    // Разброс — не 0 (проверен отдельно в telegram.backoff.test.ts), здесь фиксируем
    // его на «без отклонения», чтобы границы окна не гонялись за случайным числом.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    vi.useFakeTimers()
    try {
      // Четыре сбоя подряд — паузы должны расти, а не оставаться одинаковыми.
      for (let i = 0; i < 4; i += 1) {
        mocks.getUpdatesQueue.push({ ok: false, reason: 'failed', status: null, description: 'connect ECONNREFUSED' })
      }
      await runtime.startPollingLoop('secret')
      // 1-й запрос происходит синхронно внутри startPollingLoop (до всякой паузы) —
      // проверяем это без vi.waitFor: у него на fake-timers свой интервал ожидания,
      // и лишнее «тиканье» до первой проверки испортило бы дальше отсчёт от t=0.
      expect(mocks.getUpdatesCalls.length).toBe(1) // 1-й сбой, t=0

      // Без разброса паузы идут ровно 1с → 2с → 4с от старта: дедлайны на абсолютной
      // шкале фейкового времени — t=1000 (2-й сбой), t=3000 (3-й), t=7000 (4-й).
      await vi.advanceTimersByTimeAsync(850) // t=850 — до дедлайна 1000
      expect(mocks.getUpdatesCalls.length).toBe(1)
      await vi.advanceTimersByTimeAsync(300) // t=1150 — дедлайн 1000 точно прошёл
      expect(mocks.getUpdatesCalls.length).toBe(2) // 2-й сбой

      await vi.advanceTimersByTimeAsync(1_700) // t=2850 — до дедлайна 3000
      expect(mocks.getUpdatesCalls.length).toBe(2)
      await vi.advanceTimersByTimeAsync(300) // t=3150 — дедлайн 3000 точно прошёл
      expect(mocks.getUpdatesCalls.length).toBe(3) // 3-й сбой

      await vi.advanceTimersByTimeAsync(3_700) // t=6850 — до дедлайна 7000
      expect(mocks.getUpdatesCalls.length).toBe(3)
      await vi.advanceTimersByTimeAsync(300) // t=7150 — дедлайн 7000 точно прошёл
      expect(mocks.getUpdatesCalls.length).toBe(4) // 4-й сбой
    } finally {
      vi.useRealTimers()
      randomSpy.mockRestore()
    }
  })

  it('в журнал — одна запись на смену состояния, не на каждую попытку', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    vi.useFakeTimers()
    try {
      mocks.getUpdatesQueue.push({ ok: false, reason: 'failed', status: null, description: 'connect ECONNREFUSED' })
      mocks.getUpdatesQueue.push({ ok: false, reason: 'failed', status: null, description: 'connect ECONNREFUSED' })
      mocks.getUpdatesQueue.push({ ok: false, reason: 'failed', status: null, description: 'connect ECONNREFUSED' })
      mocks.getUpdatesQueue.push({ ok: true, updates: [] }) // связь восстановилась
      await runtime.startPollingLoop('secret')
      expect(mocks.getUpdatesCalls.length).toBe(1) // 1-й сбой, t=0 (см. пояснение в тесте выше)

      // Без разброса дедлайны на абсолютной шкале: t=1000, t=3000, t=7000.
      await vi.advanceTimersByTimeAsync(1_200) // t=1200 — 1-я пауза (до 1000) прошла
      expect(mocks.getUpdatesCalls.length).toBe(2)
      await vi.advanceTimersByTimeAsync(2_100) // t=3300 — 2-я пауза (до 3000) прошла
      expect(mocks.getUpdatesCalls.length).toBe(3)
      await vi.advanceTimersByTimeAsync(4_000) // t=7300 — 3-я пауза (до 7000) прошла
      // Успех (4-й вызов) — связь восстановлена; цикл сразу зовёт getUpdates дальше без паузы (5-й вызов).
      expect(mocks.getUpdatesCalls.length).toBeGreaterThanOrEqual(4)

      // Одно предупреждение при первом сбое (не три — по одному на каждый).
      expect(mocks.logWarn.mock.calls.filter(([msg]) => String(msg).includes('связь потеряна'))).toHaveLength(1)
      // И одна запись о восстановлении после серии сбоев.
      expect(mocks.logInfo.mock.calls.filter(([msg]) => String(msg).includes('связь восстановлена'))).toHaveLength(1)
    } finally {
      vi.useRealTimers()
      randomSpy.mockRestore()
    }
  })

  it('stop() прерывает ожидание паузы сразу же, а не ждёт её конца', async () => {
    mocks.getUpdatesQueue.push({ ok: false, reason: 'failed', status: null, description: 'connect ECONNREFUSED' })
    await runtime.startPollingLoop('secret')
    // Ждём реальным временем, пока цикл дойдёт до сбоя и начнёт паузу (~60с максимум).
    await vi.waitFor(() => expect(mocks.getUpdatesCalls.length).toBeGreaterThanOrEqual(1))

    const startedAt = Date.now()
    await runtime.stop()
    expect(Date.now() - startedAt).toBeLessThan(1000)
    expect(runtime.getRuntimeStatus().running).toBe('off')
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

describe('applyMode (смена режима из админки, решение 142)', () => {
  it('polling → webhook: цикл останавливается', async () => {
    await runtime.applyMode('secret', 'polling')
    expect(runtime.getRuntimeStatus().running).toBe('polling')
    await runtime.applyMode('secret', 'webhook')
    expect(runtime.getRuntimeStatus().running).toBe('off')
  })

  it('webhook → polling: цикл запускается, вебхук снимается', async () => {
    await runtime.applyMode('secret', 'webhook')
    expect(mocks.deleteWebhookCalls).toBe(0)
    await runtime.applyMode('secret', 'polling')
    expect(mocks.deleteWebhookCalls).toBe(1)
    expect(runtime.getRuntimeStatus().running).toBe('polling')
  })

  it('повторные applyMode(\'auto\') не копят таймеры: за 5 минут проверка ровно одна, не две', async () => {
    vi.useFakeTimers()
    try {
      await runtime.applyMode('secret', 'auto') // +1 проверка сразу
      await runtime.applyMode('secret', 'auto') // если бы плодило таймеры — тут завёлся бы второй
      expect(mocks.webhookInfoCalls).toBe(2) // по разу на каждый immediate-вызов applyMode — это ожидаемо
      const before = mocks.webhookInfoCalls
      await vi.advanceTimersByTimeAsync(5 * 60_000)
      // Один таймер — одна дополнительная проверка через 5 минут, не две.
      expect(mocks.webhookInfoCalls).toBe(before + 1)
    } finally {
      vi.useRealTimers()
    }
  })
})
