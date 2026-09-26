import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { UserRole } from '@/shared/contracts/enums'

/**
 * Справочник пользователей и почта в нём. База подменена: проверяется, что
 * сервис отдаёт и по чему ищет, а не сама выборка.
 */
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn() }))

vi.mock('@/shared/db/prisma', () => ({
  prisma: { user: { findMany: mocks.findMany, count: mocks.count } },
}))

const { describeCurrentUser, listUsers } = await import('./auth.service')

const as = (role: UserRole): CurrentUser => ({
  id: 'me',
  email: 'me@skilllink.demo',
  fullName: 'Текущий Пользователь',
  role,
  universityId: role === 'UNIVERSITY_REP' ? 'uni-1' : null,
})

const row = {
  id: 'u1',
  email: 'colleague@skilllink.demo',
  fullName: 'Коллега Демонстрационный',
  position: 'Менеджер',
  role: 'MANAGER' as const,
  universityId: null,
  isActive: true,
  university: null,
}

const query = { page: 1, pageSize: 20, includeInactive: false, q: 'colleague' }

describe('справочник пользователей', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findMany.mockResolvedValue([row])
    mocks.count.mockResolvedValue(1)
  })

  it('менеджер и администратор видят почту и ищут по ней', async () => {
    for (const role of ['ADMIN', 'MANAGER'] as const) {
      const { data } = await listUsers(as(role), query)
      expect(data[0]?.email).toBe('colleague@skilllink.demo')
    }
    const where = mocks.findMany.mock.calls[0]?.[0]?.where
    expect(JSON.stringify(where.OR)).toContain('email')
  })

  it('аналитик и наблюдатель почту не получают и по ней не ищут', async () => {
    // Рабочие адреса всех сотрудников и представителей вузов — персональные данные
    // сверх нужного тому, кто только смотрит аналитику.
    for (const role of ['ANALYST', 'VIEWER'] as const) {
      mocks.findMany.mockClear()
      const { data } = await listUsers(as(role), query)
      expect(data[0]?.email).toBeNull()
      expect(data[0]?.fullName).toBe('Коллега Демонстрационный')
      const where = mocks.findMany.mock.calls[0]?.[0]?.where
      expect(JSON.stringify(where.OR)).not.toContain('email')
    }
  })

  it('представителю вуза справочник закрыт', async () => {
    await expect(listUsers(as('UNIVERSITY_REP'), query)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('права текущего пользователя', () => {
  it('записывать в кабинете вуза может только представитель', () => {
    expect(describeCurrentUser(as('UNIVERSITY_REP')).permissions.canWritePortal).toBe(true)
    expect(describeCurrentUser(as('MANAGER')).permissions.canWritePortal).toBe(false)
    expect(describeCurrentUser(as('MANAGER')).permissions.canUsePortal).toBe(true)
  })

  it('почту и телефон контактов вузов видят только ADMIN и MANAGER (решение 106)', () => {
    expect(describeCurrentUser(as('ADMIN')).permissions.canSeeContactDetails).toBe(true)
    expect(describeCurrentUser(as('MANAGER')).permissions.canSeeContactDetails).toBe(true)
    expect(describeCurrentUser(as('ANALYST')).permissions.canSeeContactDetails).toBe(false)
    expect(describeCurrentUser(as('VIEWER')).permissions.canSeeContactDetails).toBe(false)
    expect(describeCurrentUser(as('UNIVERSITY_REP')).permissions.canSeeContactDetails).toBe(false)
  })

  it('переназначать ответственного за вуз и связку может только ADMIN и HEAD (решение 146)', () => {
    expect(describeCurrentUser(as('ADMIN')).permissions.canAssignResponsible).toBe(true)
    expect(describeCurrentUser(as('HEAD')).permissions.canAssignResponsible).toBe(true)
    expect(describeCurrentUser(as('MANAGER')).permissions.canAssignResponsible).toBe(false)
    expect(describeCurrentUser(as('ANALYST')).permissions.canAssignResponsible).toBe(false)
    expect(describeCurrentUser(as('UNIVERSITY_REP')).permissions.canAssignResponsible).toBe(false)
  })

  it('эксперту хакатона экран не показывает кнопок изменения (решение 147)', () => {
    const expertAdmin = describeCurrentUser({ ...as('ADMIN'), isReviewer: true })
    expect(expertAdmin.isReviewer).toBe(true)
    expect(expertAdmin.permissions.canWrite).toBe(false)
    expect(expertAdmin.permissions.canAssignResponsible).toBe(false)
    expect(expertAdmin.permissions.isAdmin).toBe(false)
    expect(expertAdmin.permissions.canSeeAnalytics).toBe(true)
    expect(expertAdmin.permissions.canSeeContactDetails).toBe(true)
    const expertRep = describeCurrentUser({ ...as('UNIVERSITY_REP'), isReviewer: true })
    expect(expertRep.permissions.canUsePortal).toBe(true)
    expect(expertRep.permissions.canWritePortal).toBe(false)
  })
})
