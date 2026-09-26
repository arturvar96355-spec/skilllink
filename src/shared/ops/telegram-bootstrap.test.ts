import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Запуск приёма Telegram при первом запросе к серверу (решение 142) — не в
 * `instrumentation.ts` (см. комментарий в самом модуле, почему: Prisma не
 * собирается для edge-варианта `instrumentation.ts`, а `handle.ts` — обычная
 * обёртка маршрутов без второй, edge-цели сборки).
 */

const mocks = vi.hoisted(() => ({
  enabled: true,
  mode: 'auto' as 'webhook' | 'polling' | 'auto',
  loadRuntimeOverrides: vi.fn(async () => undefined),
  runtimeStart: vi.fn(async () => undefined),
  runtimeStop: vi.fn(async () => undefined),
}))

vi.mock('@/shared/auth/secret', () => ({ resolveSecret: () => 'auth-secret' }))
vi.mock('@/integrations/telegram/runtime-config', () => ({
  loadRuntimeOverrides: mocks.loadRuntimeOverrides,
  effectiveTelegramConfig: () => ({ enabled: mocks.enabled, mode: mocks.mode }),
}))
vi.mock('@/modules/telegram/telegram.runtime', () => ({
  start: mocks.runtimeStart,
  stop: mocks.runtimeStop,
}))

const bootstrap = await import('./telegram-bootstrap')

beforeEach(() => {
  mocks.enabled = true
  mocks.mode = 'auto'
  mocks.loadRuntimeOverrides.mockClear()
  mocks.runtimeStart.mockClear()
  mocks.runtimeStop.mockClear()
  bootstrap.resetTelegramBootstrapForTests()
  vi.spyOn(process, 'once').mockImplementation(() => process)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('ensureTelegramRuntimeStarted', () => {
  it('не промышленный режим — ничего не запускает', () => {
    vi.stubEnv('NODE_ENV', 'test')
    bootstrap.ensureTelegramRuntimeStarted()
    expect(mocks.loadRuntimeOverrides).not.toHaveBeenCalled()
  })

  it('промышленный режим, бот настроен — запускает рантайм ровно один раз', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    bootstrap.ensureTelegramRuntimeStarted()
    bootstrap.ensureTelegramRuntimeStarted()
    bootstrap.ensureTelegramRuntimeStarted()
    await vi.waitFor(() => expect(mocks.runtimeStart).toHaveBeenCalledTimes(1))
    expect(mocks.runtimeStart).toHaveBeenCalledWith('auth-secret')
    expect(mocks.loadRuntimeOverrides).toHaveBeenCalledTimes(1)
  })

  it('бот не настроен — loadRuntimeOverrides вызывается (проверить базу), но рантайм не стартует', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    mocks.enabled = false
    bootstrap.ensureTelegramRuntimeStarted()
    await vi.waitFor(() => expect(mocks.loadRuntimeOverrides).toHaveBeenCalledTimes(1))
    expect(mocks.runtimeStart).not.toHaveBeenCalled()
  })

  it('вызов не бросает и не ждёт — вернулась управление сразу же', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => bootstrap.ensureTelegramRuntimeStarted()).not.toThrow()
    // Дожидаемся, чтобы фоновая цепочка этого теста не «утекла» в следующий —
    // иначе её отложенный вызов runtime.start() всплыл бы там вторым разом.
    await vi.waitFor(() => expect(mocks.runtimeStart).toHaveBeenCalledTimes(1))
  })

  it('SIGTERM после успешного старта останавливает рантайм ровно один раз', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    bootstrap.ensureTelegramRuntimeStarted()
    await vi.waitFor(() => expect(mocks.runtimeStart).toHaveBeenCalledTimes(1))

    const calls = (process.once as unknown as { mock: { calls: [string, () => void][] } }).mock.calls
    const [, handler] = calls.find(([name]) => name === 'SIGTERM')!
    handler()
    handler()
    await vi.waitFor(() => expect(mocks.runtimeStop).toHaveBeenCalledTimes(1))
  })
})
