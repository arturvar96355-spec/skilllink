import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Единый вход через Keycloak (ТЗ, функц. 10; решение 188). База и журнал
 * подменены — проверяется ровно то, что решает, пускать ли: сопоставление
 * по email с активной записью `users`, а не доверие токену Keycloak.
 */
const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  writeAudit: vi.fn(),
  headers: vi.fn(),
}))

vi.mock('@/shared/db/prisma', () => ({ prisma: { user: { findFirst: mocks.findFirst } } }))
vi.mock('@/shared/audit/audit', () => ({ writeAudit: mocks.writeAudit }))
vi.mock('next/headers', () => ({ headers: mocks.headers }))

const { isKeycloakEnabled, resolveKeycloakLoginUser, auditKeycloakLogin } = await import('./keycloak')

const manager = {
  id: 'u-manager',
  email: 'manager@skilllink.demo',
  fullName: 'Кириллов Пётр Андреевич',
  role: 'MANAGER' as const,
  universityId: null,
  sessionVersion: 0,
}

const reviewer = {
  id: 'u-expert-manager',
  email: 'expert-manager@skilllink.demo',
  fullName: 'Эксперт — менеджер',
  role: 'MANAGER' as const,
  universityId: null,
  sessionVersion: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  // Вне контекста запроса (эти тесты) — как отсутствие заголовка.
  mocks.headers.mockRejectedValue(new Error('вне контекста запроса'))
})

afterEach(() => {
  delete process.env.KEYCLOAK_ISSUER
  delete process.env.KEYCLOAK_CLIENT_ID
  delete process.env.KEYCLOAK_CLIENT_SECRET
})

describe('isKeycloakEnabled', () => {
  it('ни одна переменная не задана — выключено', () => {
    expect(isKeycloakEnabled()).toBe(false)
  })

  it('заданы все три переменные — включено', () => {
    process.env.KEYCLOAK_ISSUER = 'http://localhost:8081/auth/realms/skilllink'
    process.env.KEYCLOAK_CLIENT_ID = 'skilllink-web'
    process.env.KEYCLOAK_CLIENT_SECRET = 'secret'
    expect(isKeycloakEnabled()).toBe(true)
  })

  it.each(['KEYCLOAK_ISSUER', 'KEYCLOAK_CLIENT_ID', 'KEYCLOAK_CLIENT_SECRET'])(
    'не хватает одной переменной (%s) — выключено, это и есть откат',
    (missing) => {
      process.env.KEYCLOAK_ISSUER = 'http://localhost:8081/auth/realms/skilllink'
      process.env.KEYCLOAK_CLIENT_ID = 'skilllink-web'
      process.env.KEYCLOAK_CLIENT_SECRET = 'secret'
      delete process.env[missing]
      expect(isKeycloakEnabled()).toBe(false)
    },
  )

  it('пустая строка считается незаданной переменной', () => {
    process.env.KEYCLOAK_ISSUER = ''
    process.env.KEYCLOAK_CLIENT_ID = 'skilllink-web'
    process.env.KEYCLOAK_CLIENT_SECRET = 'secret'
    expect(isKeycloakEnabled()).toBe(false)
  })
})

describe('resolveKeycloakLoginUser', () => {
  it('email найден и активен — сопоставление удалось', async () => {
    mocks.findFirst.mockResolvedValueOnce(manager)

    const result = await resolveKeycloakLoginUser('Manager@SkillLink.Demo')

    expect(result).toEqual({ outcome: 'ok', user: manager })
    // Почта приводится к нижнему регистру и обрезается — как у Credentials.
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { email: 'manager@skilllink.demo', isActive: true },
      select: { id: true, email: true, fullName: true, role: true, universityId: true, sessionVersion: true },
    })
  })

  it('учётная запись с признаком is_reviewer тоже сопоставляется как обычная', async () => {
    mocks.findFirst.mockResolvedValueOnce(reviewer)

    const result = await resolveKeycloakLoginUser('expert-manager@skilllink.demo')

    expect(result).toEqual({ outcome: 'ok', user: reviewer })
  })

  it('email не найден в базе — отказ', async () => {
    mocks.findFirst.mockResolvedValueOnce(null)

    const result = await resolveKeycloakLoginUser('unknown@skilllink.demo')

    expect(result).toEqual({ outcome: 'denied' })
  })

  it('заблокированная запись (isActive: false) не находится запросом — тот же отказ', async () => {
    // Запрос сам фильтрует isActive: true — блокировка проверяется в базе,
    // а не в этой функции, поэтому здесь просто null, как у неизвестного email.
    mocks.findFirst.mockResolvedValueOnce(null)

    const result = await resolveKeycloakLoginUser('former.employee@skilllink.demo')

    expect(result).toEqual({ outcome: 'denied' })
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'former.employee@skilllink.demo', isActive: true } }),
    )
  })

  it('пустая или отсутствующая почта — отказ без обращения к базе', async () => {
    expect(await resolveKeycloakLoginUser(null)).toEqual({ outcome: 'denied' })
    expect(await resolveKeycloakLoginUser(undefined)).toEqual({ outcome: 'denied' })
    expect(await resolveKeycloakLoginUser('')).toEqual({ outcome: 'denied' })
    expect(mocks.findFirst).not.toHaveBeenCalled()
  })
})

describe('auditKeycloakLogin', () => {
  it('успех пишет auth.login.success с пометкой sso: true', async () => {
    await auditKeycloakLogin({ outcome: 'ok', user: manager })

    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.login.success',
        userId: 'u-manager',
        payload: { address: 'unknown', sso: true },
      }),
    )
  })

  it('отказ пишет auth.login.failure с неизвестной учётной записью — почта в журнал не идёт', async () => {
    await auditKeycloakLogin({ outcome: 'denied' })

    const [entry] = mocks.writeAudit.mock.calls[0]!
    expect(entry).toMatchObject({ action: 'auth.login.failure', userId: null })
    expect(JSON.stringify(entry)).not.toContain('@')
  })
})
