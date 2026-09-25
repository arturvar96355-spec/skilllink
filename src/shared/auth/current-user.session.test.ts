import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/shared/http/errors'

/**
 * Сбой чтения сессии — не «сессии нет».
 *
 * Если исключение из auth() проглотить, getCurrentUser сочтёт запрос анонимным
 * и в демо-режиме отдаст его демо-пользователю с правами менеджера.
 * База, NextAuth и cookie здесь подменены: проверяется только порядок решений.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
}))

vi.mock('./auth', () => ({ auth: mocks.auth }))
vi.mock('@/shared/db/prisma', () => ({
  prisma: { user: { findFirst: mocks.findFirst, findMany: mocks.findMany } },
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}))

const { describeAuthError, getCurrentUser } = await import('./current-user')

const demoManager = {
  id: 'demo-manager',
  email: 'manager@skilllink.demo',
  fullName: 'Демонстрационный Менеджер',
  role: 'MANAGER',
  universityId: null,
}

describe('ошибка чтения сессии', () => {
  beforeEach(() => {
    vi.stubEnv('DEMO_AUTH_ENABLED', 'true')
    mocks.findMany.mockResolvedValue([demoManager])
    mocks.findFirst.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('не превращается в демо-пользователя', async () => {
    mocks.auth.mockRejectedValue(new Error('JWTSessionError: decryption failed'))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const failure = await getCurrentUser().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AppError)
    expect((failure as AppError).code).toBe('INTERNAL')
    expect(mocks.findMany).not.toHaveBeenCalled()
    expect(logged).toHaveBeenCalledWith('[AUTH] не удалось прочитать сессию:', expect.any(String))
  })

  it('без сессии демо-режим по-прежнему выбирает пользователя по умолчанию', async () => {
    mocks.auth.mockResolvedValue(null)
    await expect(getCurrentUser()).resolves.toEqual(demoManager)
  })

  it('без демо-режима и без сессии — 401', async () => {
    vi.stubEnv('DEMO_AUTH_ENABLED', 'false')
    mocks.auth.mockResolvedValue(null)
    const failure = await getCurrentUser().catch((error: unknown) => error)
    expect((failure as AppError).code).toBe('UNAUTHORIZED')
  })
})

describe('текст ошибки для журнала', () => {
  it('не содержит токенов', () => {
    const token = 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..c2VjcmV0.cGF5bG9hZA.dGFn'
    const text = describeAuthError(new Error(`Invalid token ${token}`))
    expect(text).not.toContain('eyJ')
    expect(text).toContain('[токен скрыт]')
  })

  it('ограничен по длине', () => {
    expect(describeAuthError(new Error('x'.repeat(5000))).length).toBeLessThanOrEqual(300)
  })
})
