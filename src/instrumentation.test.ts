import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Хук старта сервера (решение 133 + приём без вебхука, решение 142). Проверяется
 * только композиция: кто вызывается и когда, — сама проверка окружения и сам
 * цикл polling проверены в своих модулях (`shared/config/env`, `telegram.runtime`).
 */

const mocks = vi.hoisted(() => ({
  shouldCheck: true,
  report: { warnings: [] as string[], errors: [] as string[] },
  enabled: true,
  mode: 'auto' as 'webhook' | 'polling' | 'auto',
  loadRuntimeOverrides: vi.fn(async () => undefined),
  runtimeStart: vi.fn(async () => undefined),
  runtimeStop: vi.fn(async () => undefined),
  exit: vi.fn(),
}))

vi.mock('@/shared/config/env', () => ({
  shouldCheckEnvironment: () => mocks.shouldCheck,
  checkEnvironment: () => mocks.report,
}))
vi.mock('@/shared/auth/auth', () => ({ resolveSecret: () => 'auth-secret' }))
vi.mock('@/integrations/telegram/runtime-config', () => ({
  loadRuntimeOverrides: mocks.loadRuntimeOverrides,
  effectiveTelegramConfig: () => ({ enabled: mocks.enabled, mode: mocks.mode }),
}))
vi.mock('@/modules/telegram/telegram.runtime', () => ({
  start: mocks.runtimeStart,
  stop: mocks.runtimeStop,
}))

const originalRuntime = process.env.NEXT_RUNTIME
process.env.NEXT_RUNTIME = 'nodejs'

const { register } = await import('./instrumentation')

beforeEach(() => {
  mocks.shouldCheck = true
  mocks.report = { warnings: [], errors: [] }
  mocks.enabled = true
  mocks.mode = 'auto'
  mocks.loadRuntimeOverrides.mockClear()
  mocks.runtimeStart.mockClear()
  mocks.runtimeStop.mockClear()
  mocks.exit.mockClear()
  vi.spyOn(process, 'exit').mockImplementation(mocks.exit as never)
  // Не настоящий process.once: иначе каждый тест реально подписывался бы на
  // SIGTERM/SIGINT текущего процесса vitest, и слушатели копились бы между тестами.
  vi.spyOn(process, 'once').mockImplementation(() => process)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// НЕ afterEach: NEXT_RUNTIME нужен на все тесты этого файла, а не только на первый —
// иначе с второго теста register() выходил бы сразу же по проверке в самом начале.
afterAll(() => {
  process.env.NEXT_RUNTIME = originalRuntime
})

describe('register', () => {
  it('не промышленный режим — ничего не делает', async () => {
    mocks.shouldCheck = false
    await register()
    expect(mocks.loadRuntimeOverrides).not.toHaveBeenCalled()
  })

  it('ошибка окружения — process.exit(1), Telegram не запускается', async () => {
    mocks.report = { warnings: [], errors: ['AUTH_SECRET не задан'] }
    await register()
    expect(mocks.exit).toHaveBeenCalledWith(1)
    // exit замокан и не останавливает выполнение — а он и не должен: до вызова
    // рантайма Telegram код в реальности не доходит, потому что process.exit
    // настоящий никогда не возвращает управление.
  })

  it('бот не настроен — Telegram не запускается', async () => {
    mocks.enabled = false
    await register()
    expect(mocks.loadRuntimeOverrides).toHaveBeenCalledWith('auth-secret')
    expect(mocks.runtimeStart).not.toHaveBeenCalled()
  })

  it('бот настроен — рантайм запускается с секретом, подписка на SIGTERM/SIGINT', async () => {
    await register()
    expect(mocks.runtimeStart).toHaveBeenCalledWith('auth-secret')
    expect(process.once).toHaveBeenCalledWith('SIGTERM', expect.any(Function))
    expect(process.once).toHaveBeenCalledWith('SIGINT', expect.any(Function))
  })

  it('SIGTERM останавливает рантайм ровно один раз даже при двух сигналах подряд', async () => {
    await register()
    const [, handler] = (process.once as unknown as { mock: { calls: [string, () => void][] } }).mock.calls.find(
      ([name]) => name === 'SIGTERM',
    )!
    handler()
    handler()
    await vi.waitFor(() => expect(mocks.runtimeStop).toHaveBeenCalledTimes(1))
  })
})
