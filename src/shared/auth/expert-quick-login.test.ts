import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOGIN_THROTTLE } from '@/shared/config/auth.config'
import { resetThrottle } from './throttle'

/**
 * Быстрый вход экспертов хакатона (решение 176). База и журнал подменены —
 * проверяется ровно то, что решает, пускать ли: `is_reviewer = true` по базе
 * на каждый клик, а не список кнопок в браузере.
 */
const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  writeAudit: vi.fn(),
}))

vi.mock('@/shared/db/prisma', () => ({ prisma: { user: { findFirst: mocks.findFirst } } }))
vi.mock('@/shared/audit/audit', () => ({ writeAudit: mocks.writeAudit }))
// Идёт в фоне только для роли ADMIN (не задействована в этих тестах) — подменена
// на всякий случай, чтобы тест не трогал настоящий Prisma через security-alerts.ts.
vi.mock('@/shared/ops/security-alerts', () => ({ alertAdminLogin: vi.fn() }))

const { attemptExpertQuickLogin, expertQuickLoginRouteBlocked, isExpertQuickLoginEnabled } = await import(
  './expert-quick-login'
)

const reviewer = {
  id: 'u-manager',
  email: 'expert-manager@skilllink.demo',
  fullName: 'Эксперт — менеджер',
  role: 'MANAGER' as const,
  universityId: null,
  sessionVersion: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  resetThrottle()
})

afterEach(() => {
  delete process.env.EXPERT_QUICK_LOGIN
  resetThrottle()
})

describe('isExpertQuickLoginEnabled', () => {
  it('по умолчанию (переменная не задана) выключено', () => {
    delete process.env.EXPERT_QUICK_LOGIN
    expect(isExpertQuickLoginEnabled()).toBe(false)
  })

  it('EXPERT_QUICK_LOGIN=true включает', () => {
    process.env.EXPERT_QUICK_LOGIN = 'true'
    expect(isExpertQuickLoginEnabled()).toBe(true)
  })

  it('EXPERT_QUICK_LOGIN=1 тоже включает', () => {
    process.env.EXPERT_QUICK_LOGIN = '1'
    expect(isExpertQuickLoginEnabled()).toBe(true)
  })

  it('явное false и мусорное значение не включают', () => {
    process.env.EXPERT_QUICK_LOGIN = 'false'
    expect(isExpertQuickLoginEnabled()).toBe(false)
    process.env.EXPERT_QUICK_LOGIN = 'да'
    expect(isExpertQuickLoginEnabled()).toBe(false)
  })
})

describe('attemptExpertQuickLogin', () => {
  it('эксперт (is_reviewer = true в базе) — сессия: данные для входа приходят как есть', async () => {
    mocks.findFirst.mockResolvedValueOnce(reviewer)

    const result = await attemptExpertQuickLogin('manager', '203.0.113.10')

    expect(result).toEqual({ outcome: 'ok', user: reviewer })
    // Запрос проверяет именно is_reviewer — ключ кнопки сам по себе ничего не решает.
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { email: 'expert-manager@skilllink.demo', isActive: true, isReviewer: true },
      select: { id: true, email: true, fullName: true, role: true, universityId: true, sessionVersion: true },
    })
    // Журнал отличает быстрый вход от входа паролем.
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.login.success',
        userId: 'u-manager',
        payload: { address: '203.0.113.10', quickLogin: true },
      }),
    )
  })

  it('обычная учётная запись (is_reviewer не задан) — отказ', async () => {
    // Запрос сам фильтрует по isReviewer: true — обычная учётная запись,
    // даже существуя в базе под тем же адресом, в выборку не попадает.
    mocks.findFirst.mockResolvedValueOnce(null)

    const result = await attemptExpertQuickLogin('manager', '203.0.113.10')

    expect(result).toEqual({ outcome: 'denied' })
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login.failure', userId: null }),
    )
  })

  it('неизвестный ключ кнопки — отказ без обращения к базе', async () => {
    const result = await attemptExpertQuickLogin('owner', '203.0.113.10')

    expect(result).toEqual({ outcome: 'denied' })
    expect(mocks.findFirst).not.toHaveBeenCalled()
    expect(mocks.writeAudit).not.toHaveBeenCalled()
  })

  it('вход закрыт тем же счётчиком перебора, что у обычного входа', async () => {
    // Каждый клик, на который база не отвечает пользователем, — неудача для
    // пары «учётная запись + адрес» (throttle.ts не различает способ входа).
    mocks.findFirst.mockResolvedValue(null)
    const address = '203.0.113.20'

    for (let i = 0; i < LOGIN_THROTTLE.maxFailures; i += 1) {
      const attempt = await attemptExpertQuickLogin('rep', address)
      expect(attempt).toEqual({ outcome: 'denied' })
    }

    const blocked = await attemptExpertQuickLogin('rep', address)
    expect(blocked).toEqual({ outcome: 'blocked' })
  })
})

describe('expertQuickLoginRouteBlocked', () => {
  it('выключенная переменная — маршруты signin/expert и callback/expert отвечают 404', () => {
    delete process.env.EXPERT_QUICK_LOGIN
    expect(expertQuickLoginRouteBlocked('/api/auth/signin/expert')).toBe(true)
    expect(expertQuickLoginRouteBlocked('/api/auth/callback/expert')).toBe(true)
  })

  it('включённая переменная — те же маршруты не блокируются', () => {
    process.env.EXPERT_QUICK_LOGIN = 'true'
    expect(expertQuickLoginRouteBlocked('/api/auth/signin/expert')).toBe(false)
    expect(expertQuickLoginRouteBlocked('/api/auth/callback/expert')).toBe(false)
  })

  it('обычный вход (credentials) не блокируется независимо от флага', () => {
    delete process.env.EXPERT_QUICK_LOGIN
    expect(expertQuickLoginRouteBlocked('/api/auth/callback/credentials')).toBe(false)
    expect(expertQuickLoginRouteBlocked('/api/auth/session')).toBe(false)
    expect(expertQuickLoginRouteBlocked('/api/auth/csrf')).toBe(false)
  })
})
