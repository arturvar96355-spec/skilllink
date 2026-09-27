import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { CooperationStatus, StageStatus, UserRole } from '@/shared/contracts/enums'
import { REVIEWER_FORBIDDEN_MESSAGE } from '@/shared/auth/permissions'
import { TELEGRAM_ACTIONS } from '@/shared/config/telegram.config'
import { expectRejectCode } from '@/shared/testing/expect-code'

/**
 * «Принял, беру в работу» по этапу (решение 200): права как у изменения этапа,
 * отметка — в журнал один раз, сам этап не меняется. База и журнал подменены.
 */

const mocks = vi.hoisted(() => ({
  cooperationFindUnique: vi.fn(),
  stageFindUnique: vi.fn(),
  stageUpdate: vi.fn(),
  recordAuditOnce: vi.fn(),
  writeAudit: vi.fn(),
}))

vi.mock('@/shared/db/prisma', () => ({
  prisma: {
    cooperation: { findUnique: mocks.cooperationFindUnique },
    workflowStage: { findUnique: mocks.stageFindUnique, update: mocks.stageUpdate, updateMany: mocks.stageUpdate },
  },
}))
vi.mock('@/shared/audit/audit', () => ({ writeAudit: mocks.writeAudit, recordAuditOnce: mocks.recordAuditOnce }))
vi.mock('@/modules/recommendations/recommendations.service', () => ({ syncCooperation: vi.fn() }))

const service = await import('./workflow.service')

const as = (role: UserRole, extra: Partial<CurrentUser> = {}): CurrentUser => ({
  id: `${role.toLowerCase()}-1`,
  email: 'user@example.invalid',
  fullName: 'Тестовый Пользователь',
  role,
  universityId: role === 'UNIVERSITY_REP' ? 'uni-2' : null,
  ...extra,
})

const NOW = new Date('2026-09-28T11:05:00Z')
let stageStatus: StageStatus
let cooperationStatus: CooperationStatus

beforeEach(() => {
  vi.clearAllMocks()
  stageStatus = 'IN_PROGRESS'
  cooperationStatus = 'ACTIVE'
  mocks.stageFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id === 'stage-3'
      ? {
          id: 'stage-3',
          cooperationId: 'coop-1',
          stageNumber: 3,
          title: 'Договор',
          status: stageStatus,
          cooperation: { university: { name: 'Санкт-Петербургский университет телекоммуникаций', shortName: 'СПбГУТ' } },
        }
      : null,
  )
  mocks.cooperationFindUnique.mockImplementation(async () => ({ universityId: 'uni-1', status: cooperationStatus }))
  mocks.recordAuditOnce.mockResolvedValue({ created: true, at: NOW })
})

describe('acceptStage', () => {
  it('менеджер: запись stage.accept в журнал, окно — срок жизни кнопки, этап не меняется', async () => {
    const result = await service.acceptStage(as('MANAGER'), 'stage-3', { source: 'telegram', now: NOW })

    expect(result).toEqual({ acceptedAt: NOW, alreadyAccepted: false, label: 'этап 3 «Договор», СПбГУТ' })
    expect(mocks.recordAuditOnce).toHaveBeenCalledWith(
      {
        userId: 'manager-1',
        action: 'stage.accept',
        objectType: 'WorkflowStage',
        objectId: 'stage-3',
        payload: { source: 'telegram', stageNumber: 3 },
      },
      new Date(NOW.getTime() - TELEGRAM_ACTIONS.ttlMs),
    )
    expect(mocks.stageUpdate).not.toHaveBeenCalled()
  })

  it('повторное нажатие — время первой отметки, alreadyAccepted', async () => {
    const first = new Date('2026-09-28T06:30:00Z')
    mocks.recordAuditOnce.mockResolvedValue({ created: false, at: first })
    expect(await service.acceptStage(as('HEAD'), 'stage-3', { source: 'telegram', now: NOW })).toMatchObject({
      acceptedAt: first,
      alreadyAccepted: true,
    })
  })

  it('эксперт (даже с ролью ADMIN) — 403 с текстом для эксперта, в журнал ничего', async () => {
    await expect(
      service.acceptStage(as('ADMIN', { isReviewer: true }), 'stage-3', { source: 'telegram', now: NOW }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: REVIEWER_FORBIDDEN_MESSAGE })
    expect(mocks.recordAuditOnce).not.toHaveBeenCalled()
  })

  it('аналитик, наблюдатель, представитель вуза — только чтение, 403', async () => {
    for (const role of ['ANALYST', 'VIEWER', 'UNIVERSITY_REP'] as const) {
      await expectRejectCode(service.acceptStage(as(role), 'stage-3', { source: 'telegram', now: NOW }), 'FORBIDDEN')
    }
    expect(mocks.recordAuditOnce).not.toHaveBeenCalled()
  })

  it('этап закрыт или связка закрыта — 409; этапа нет — 404', async () => {
    stageStatus = 'COMPLETED'
    await expectRejectCode(service.acceptStage(as('MANAGER'), 'stage-3', { source: 'telegram' }), 'CONFLICT')
    stageStatus = 'IN_PROGRESS'
    cooperationStatus = 'COMPLETED'
    await expectRejectCode(service.acceptStage(as('MANAGER'), 'stage-3', { source: 'telegram' }), 'CONFLICT')
    await expectRejectCode(service.acceptStage(as('MANAGER'), 'stage-404', { source: 'telegram' }), 'NOT_FOUND')
    expect(mocks.recordAuditOnce).not.toHaveBeenCalled()
  })
})
