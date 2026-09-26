import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Токен, имя бота и режим из базы главнее env (решение 142). База и шифрование
 * подменены — проверяется только логика кеша и слияния с env-конфигурацией.
 */

const mocks = vi.hoisted(() => ({
  values: new Map<string, string>(),
}))

vi.mock('@/shared/db/system-secrets.repo', () => ({
  findSecretValue: vi.fn(async (name: string) => mocks.values.get(name) ?? null),
  saveSecretValue: vi.fn(async (name: string, value: string) => {
    mocks.values.set(name, value)
    return new Date('2026-09-26T10:00:00Z')
  }),
  deleteSecret: vi.fn(async (name: string) => mocks.values.delete(name)),
}))

vi.mock('@/integrations/config', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/integrations/config')>()
  return {
    ...original,
    getIntegrationsConfig: () => ({
      ...original.getIntegrationsConfig(),
      telegram: {
        botToken: 'env-token',
        botUsername: 'env_bot',
        webhookSecret: 'hook',
        apiBase: original.TELEGRAM_DEFAULT_API_BASE,
        apiIp: null,
        timeoutMs: 1000,
        enabled: true,
        mode: 'auto',
      },
    }),
  }
})

const runtime = await import('./runtime-config')

beforeEach(() => {
  mocks.values.clear()
  runtime.resetRuntimeOverridesForTests()
})
afterEach(() => {
  runtime.resetRuntimeOverridesForTests()
})

describe('effectiveTelegramConfig', () => {
  it('без записей в базе — конфигурация из env как есть', () => {
    expect(runtime.effectiveTelegramConfig()).toMatchObject({ botToken: 'env-token', botUsername: 'env_bot', mode: 'auto' })
    expect(runtime.tokenSource()).toBe('env')
  })

  it('после setBotToken — токен и имя из базы, источник database', async () => {
    await runtime.setBotToken('auth-secret', '999:dbtoken', 'db_bot', 'admin-1')
    expect(runtime.effectiveTelegramConfig()).toMatchObject({ botToken: '999:dbtoken', botUsername: 'db_bot' })
    expect(runtime.tokenSource()).toBe('database')
    // В базе — зашифрованное значение, не открытый текст.
    expect(mocks.values.get('telegram.bot_token')).not.toContain('999:dbtoken')
  })

  it('clearBotToken — снова источник env (если он задан) или none', async () => {
    await runtime.setBotToken('auth-secret', '999:dbtoken', 'db_bot', 'admin-1')
    await runtime.clearBotToken()
    expect(runtime.tokenSource()).toBe('env')
    expect(runtime.effectiveTelegramConfig().botToken).toBe('env-token')
  })

  it('setMode — режим из базы главнее env, до следующей смены', async () => {
    expect(runtime.effectiveTelegramConfig().mode).toBe('auto')
    await runtime.setMode('polling', 'admin-1')
    expect(runtime.effectiveTelegramConfig().mode).toBe('polling')
  })

  it('loadRuntimeOverrides поднимает сохранённые значения в кеш процесса', async () => {
    await runtime.setBotToken('auth-secret', '111:x', 'bot1', 'admin-1')
    await runtime.setMode('webhook', 'admin-1')
    runtime.resetRuntimeOverridesForTests()
    expect(runtime.tokenSource()).toBe('env') // кеш сброшен, ещё не загружен

    await runtime.loadRuntimeOverrides('auth-secret')
    expect(runtime.tokenSource()).toBe('database')
    expect(runtime.effectiveTelegramConfig()).toMatchObject({ botToken: '111:x', botUsername: 'bot1', mode: 'webhook' })
  })

  it('loadRuntimeOverrides с неверным секретом (сменился AUTH_SECRET) — токен не расшифрован, как будто его нет', async () => {
    await runtime.setBotToken('auth-secret', '111:x', 'bot1', 'admin-1')
    runtime.resetRuntimeOverridesForTests()
    await runtime.loadRuntimeOverrides('другой-секрет')
    expect(runtime.tokenSource()).toBe('env')
  })
})
