import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectRejectCode } from '@/shared/testing/expect-code'
import type { CurrentUser } from '@/shared/auth/current-user'

/**
 * Смена ответственного за связку → уведомление новому ответственному (решение 205,
 * замечание продукт-менеджера S4). Сервис связки и сервис уведомлений — настоящие;
 * подменены репозитории и канал (`sendToUser`): проверяется вся цепочка «PATCH →
 * запись → журнал → отправка», а не только вызов функции.
 */
const coopRepo = vi.hoisted(() => ({
  findById: vi.fn(),
  update: vi.fn(),
}))
vi.mock('./cooperation.repo', () => coopRepo)
vi.mock('@/modules/workflow/workflow.repo', () => ({ findStagesByCooperation: vi.fn(async () => []) }))
vi.mock('@/shared/links/entity-links', () => ({ assertStaffResponsible: vi.fn() }))

const audit = vi.hoisted(() => ({ writeAudit: vi.fn() }))
vi.mock('@/shared/audit/audit', () => audit)

const notificationsRepo = vi.hoisted(() => ({ loadAssignmentContext: vi.fn() }))
vi.mock('@/modules/notifications/notifications.repo', () => notificationsRepo)

const channels = vi.hoisted(() => ({ sendToUser: vi.fn() }))
vi.mock('@/modules/notify-channels/notify-channels.service', () => channels)

const service = await import('./cooperation.service')

function admin(): CurrentUser {
  return { id: 'admin-1', email: 'admin@test.local', fullName: 'Админ', role: 'ADMIN', universityId: null }
}

function existing(responsibleId = 'manager-2') {
  return {
    id: 'coop-1',
    universityId: 'uni-1',
    programId: 'prog-1',
    productId: null,
    status: 'ACTIVE',
    goal: null,
    notes: null,
    firstContactAt: null,
    classesStartAt: null,
    targetDate: null,
    startedAt: null,
    closedAt: null,
    contractNumber: null,
    licenseSignedAt: null,
    licenseTermYears: null,
    transferStatus: null,
    comment: null,
    isMock: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    university: { id: 'uni-1', name: 'СПбГУТ', shortName: 'СПбГУТ' },
    program: { id: 'prog-1', name: 'Программная инженерия' },
    product: null,
    responsible: { id: responsibleId, fullName: 'Сотрудник', role: 'MANAGER' },
    stages: [],
  }
}

/** Отправка идёт в фоне (ответ PATCH её не ждёт) — дать ей закончиться. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  vi.clearAllMocks()
  coopRepo.findById.mockResolvedValue(existing())
  coopRepo.update.mockResolvedValue(1)
  notificationsRepo.loadAssignmentContext.mockResolvedValue({
    scope: 'cooperation',
    cooperationId: 'coop-1',
    universityName: 'СПбГУТ',
    programName: 'Программная инженерия',
    stages: [],
  })
  channels.sendToUser.mockResolvedValue({ sent: true, channel: 'telegram' })
})

describe('PATCH /api/cooperations/:id — responsibleId', () => {
  it('новому ответственному уходит уведомление; запись — при условии, что ответственный всё ещё прежний', async () => {
    await service.update(admin(), 'coop-1', { responsibleId: 'manager-1' })
    await settle()

    expect(coopRepo.update).toHaveBeenCalledWith(
      'coop-1',
      { status: 'ACTIVE', responsibleId: 'manager-2' },
      expect.objectContaining({ responsibleId: 'manager-1' }),
    )
    expect(audit.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'cooperation.responsible.set',
        objectId: 'coop-1',
        payload: { responsibleId: 'manager-1', previousResponsibleId: 'manager-2' },
      }),
    )
    expect(channels.sendToUser).toHaveBeenCalledTimes(1)
    expect(channels.sendToUser.mock.calls[0]?.[0]).toBe('manager-1')
  })

  it('повторный PATCH с тем же ответственным — без уведомления и без записи о смене', async () => {
    await service.update(admin(), 'coop-1', { responsibleId: 'manager-2' })
    await settle()

    expect(coopRepo.update).toHaveBeenCalledWith('coop-1', 'ACTIVE', expect.anything())
    expect(audit.writeAudit.mock.calls.map(([entry]) => entry.action)).not.toContain('cooperation.responsible.set')
    expect(channels.sendToUser).not.toHaveBeenCalled()
  })

  it('назначил сам себя — уведомления нет', async () => {
    await service.update(admin(), 'coop-1', { responsibleId: 'admin-1' })
    await settle()
    expect(channels.sendToUser).not.toHaveBeenCalled()
  })

  it('ошибка отправки не ломает назначение: PATCH успешен', async () => {
    channels.sendToUser.mockRejectedValue(new Error('Telegram недоступен'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const dto = await service.update(admin(), 'coop-1', { responsibleId: 'manager-1' })
    await settle()

    expect(dto.id).toBe('coop-1')
    expect(channels.sendToUser).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('ответственного успели сменить между чтением и записью — 409, уведомления нет', async () => {
    coopRepo.update.mockResolvedValue(0)
    await expectRejectCode(service.update(admin(), 'coop-1', { responsibleId: 'manager-1' }), 'CONFLICT')
    await settle()
    expect(channels.sendToUser).not.toHaveBeenCalled()
  })
})
