import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/shared/http/errors'
import type { CurrentUser } from '@/shared/auth/current-user'

/**
 * PATCH /api/universities/:id/responsible (ТЗ — роль «Руководитель», решение 146):
 * назначение, смена и снятие ответственного за вуз. Только ASSIGN_RESPONSIBLE
 * (ADMIN, HEAD) — обычный менеджер не переставляет чужого ответственного.
 */
const repo = vi.hoisted(() => ({
  findById: vi.fn(),
  update: vi.fn(),
  setResponsibleIfUnchanged: vi.fn(),
  countCooperationsByUniversity: vi.fn(),
}))
vi.mock('./universities.repo', () => repo)

const entityLinks = vi.hoisted(() => ({ assertStaffResponsible: vi.fn() }))
vi.mock('@/shared/links/entity-links', () => entityLinks)

const audit = vi.hoisted(() => ({ writeAudit: vi.fn() }))
vi.mock('@/shared/audit/audit', () => audit)

const analytics = vi.hoisted(() => ({ universityRatingsForPage: vi.fn() }))
vi.mock('@/modules/analytics/analytics.service', () => analytics)

// Уведомление новому ответственному (решение 205) — сама отправка проверена в
// notifications.assignment.test.ts; здесь — что сервис зовёт её с верной сменой.
const notifications = vi.hoisted(() => ({ notifyResponsibleAssigned: vi.fn() }))
vi.mock('@/modules/notifications/notifications.service', () => notifications)

const service = await import('./universities.service')

function admin(): CurrentUser {
  return { id: 'admin-1', email: 'admin@skilllink.demo', fullName: 'Админ', role: 'ADMIN', universityId: null }
}
function head(): CurrentUser {
  return { id: 'head-1', email: 'head@skilllink.demo', fullName: 'Руководитель', role: 'HEAD', universityId: null }
}
function manager(): CurrentUser {
  return { id: 'mgr-1', email: 'manager@skilllink.demo', fullName: 'Менеджер', role: 'MANAGER', universityId: null }
}

const EXISTING = {
  id: 'uni-1',
  name: 'СПбГУТ',
  shortName: 'СПбГУТ',
  city: 'Санкт-Петербург',
  region: 'Санкт-Петербург',
  status: 'ACTIVE' as const,
  isMock: true,
  responsibleId: null,
  responsible: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  archivedAt: null,
  _count: { programs: 0, cooperations: 0 },
  address: null,
  website: null,
  description: null,
  directionCount: null,
  studentCount: null,
  inn: null,
  ogrn: null,
  mergedIntoId: null,
  contacts: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.findById.mockResolvedValue(EXISTING)
  repo.setResponsibleIfUnchanged.mockResolvedValue(true)
  repo.countCooperationsByUniversity.mockResolvedValue(new Map())
  analytics.universityRatingsForPage.mockResolvedValue(new Map())
})

describe('setResponsible', () => {
  it('менеджеру недоступно — только ADMIN и HEAD', async () => {
    await expect(service.setResponsible(manager(), 'uni-1', { responsibleId: 'user-2' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(repo.setResponsibleIfUnchanged).not.toHaveBeenCalled()
  })

  it('ADMIN может назначить ответственного', async () => {
    await service.setResponsible(admin(), 'uni-1', { responsibleId: 'user-2' })
    expect(entityLinks.assertStaffResponsible).toHaveBeenCalledWith('user-2')
    expect(repo.setResponsibleIfUnchanged).toHaveBeenCalledWith('uni-1', null, 'user-2')
  })

  it('HEAD может назначить ответственного', async () => {
    await service.setResponsible(head(), 'uni-1', { responsibleId: 'user-2' })
    expect(repo.setResponsibleIfUnchanged).toHaveBeenCalledWith('uni-1', null, 'user-2')
  })

  it('null снимает ответственного без проверки assertStaffResponsible', async () => {
    repo.findById.mockResolvedValue({ ...EXISTING, responsibleId: 'user-1' })
    await service.setResponsible(admin(), 'uni-1', { responsibleId: null })
    expect(entityLinks.assertStaffResponsible).not.toHaveBeenCalled()
    expect(repo.setResponsibleIfUnchanged).toHaveBeenCalledWith('uni-1', 'user-1', null)
  })

  it('ответственного успели сменить между чтением и записью — 409, без журнала и уведомления', async () => {
    repo.setResponsibleIfUnchanged.mockResolvedValue(false)
    await expect(service.setResponsible(admin(), 'uni-1', { responsibleId: 'user-2' })).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(audit.writeAudit).not.toHaveBeenCalled()
    expect(notifications.notifyResponsibleAssigned).not.toHaveBeenCalled()
  })

  it('после записи зовёт уведомление с новым и прежним ответственным и автором (решение 205)', async () => {
    repo.findById.mockResolvedValue({ ...EXISTING, responsibleId: 'user-1' })
    await service.setResponsible(admin(), 'uni-1', { responsibleId: 'user-2' })
    expect(notifications.notifyResponsibleAssigned).toHaveBeenCalledWith({
      scope: 'university',
      objectId: 'uni-1',
      actorId: 'admin-1',
      responsibleId: 'user-2',
      previousResponsibleId: 'user-1',
    })
  })

  it('пишет в журнал новый и прежний responsibleId', async () => {
    repo.findById.mockResolvedValue({ ...EXISTING, responsibleId: 'user-1' })
    await service.setResponsible(admin(), 'uni-1', { responsibleId: 'user-2' })
    expect(audit.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'university.responsible.set',
        objectType: 'University',
        objectId: 'uni-1',
        payload: { responsibleId: 'user-2', previousResponsibleId: 'user-1' },
      }),
    )
  })

  it('вуз не найден — NOT_FOUND', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(service.setResponsible(admin(), 'missing', { responsibleId: 'user-2' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('несуществующего или неподходящего сотрудника отклоняет assertStaffResponsible', async () => {
    entityLinks.assertStaffResponsible.mockRejectedValue(new AppError('VALIDATION_ERROR', 'Сотрудник не найден'))
    await expect(service.setResponsible(admin(), 'uni-1', { responsibleId: 'ghost' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
    expect(repo.setResponsibleIfUnchanged).not.toHaveBeenCalled()
  })
})
