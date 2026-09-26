import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectRejectCode } from '@/shared/testing/expect-code'
import type { CurrentUser } from '@/shared/auth/current-user'

/**
 * update(): гонка двух одновременных PATCH статуса одной связки (решение 187,
 * находка ревью 27.09). Раньше `repo.update` писал безусловно: оба запроса
 * читают один и тот же `existing.status`, оба проходят проверку перехода по
 * нему и оба пишут — эффект зависит от того, какой запрос пришёл последним,
 * без ошибки и следа для первого. Условное обновление (как в
 * workflow.service.ts у этапов) отвечает 409, если статус успели сменить
 * между чтением и записью.
 *
 * Сервис подменён по репозиторию (`./cooperation.repo`): настоящая гонка и
 * транзакция — дело `updateMany`, здесь проверяется реакция сервиса на её
 * исход (0 изменённых строк).
 */
const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  update: vi.fn(),
  findStagesByCooperation: vi.fn(async () => [] as unknown[]),
}))

vi.mock('./cooperation.repo', () => mocks)
vi.mock('@/shared/audit/audit', () => ({ writeAudit: vi.fn() }))
vi.mock('@/modules/workflow/workflow.repo', () => ({ findStagesByCooperation: mocks.findStagesByCooperation }))

const service = await import('./cooperation.service')

function user(role: CurrentUser['role'] = 'MANAGER'): CurrentUser {
  return { id: 'u1', email: 'm@test.local', fullName: 'Менеджер', role, universityId: null }
}

function existing(overrides: Record<string, unknown> = {}) {
  return {
    id: 'coop-1',
    universityId: 'uni-1',
    programId: 'prog-1',
    productId: null,
    status: 'ACTIVE',
    responsibleId: 'u1',
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
    // Только то, что нужно update() (status/productId/universityId/programId) и
    // повторному findById внутри getById() на успешном пути (university/program/
    // product/responsible/stages — для toListItem).
    university: { id: 'uni-1', name: 'СПбГУТ', shortName: 'СПбГУТ' },
    program: { id: 'prog-1', name: 'Программная инженерия' },
    product: null,
    responsible: { id: 'u1', fullName: 'Менеджер', role: 'MANAGER' },
    stages: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('update: условное обновление по прочитанному статусу', () => {
  it('статус сменили между чтением и записью (0 изменённых строк) — 409, а не тихая перезапись', async () => {
    mocks.findById.mockResolvedValue(existing())
    mocks.update.mockResolvedValue(0)

    await expectRejectCode(service.update(user(), 'coop-1', { status: 'PAUSED' }), 'CONFLICT')

    expect(mocks.update).toHaveBeenCalledWith('coop-1', 'ACTIVE', expect.objectContaining({ status: 'PAUSED' }))
  })

  it('статус не менялся (1 изменённая строка) — проходит и передаёт прочитанный статус в repo.update', async () => {
    mocks.findById.mockResolvedValue(existing())
    mocks.update.mockResolvedValue(1)

    await service.update(user(), 'coop-1', { status: 'PAUSED' })

    expect(mocks.update).toHaveBeenCalledWith('coop-1', 'ACTIVE', expect.objectContaining({ status: 'PAUSED' }))
  })

  it('другие поля (без смены статуса) — тоже проверяются по прочитанному статусу', async () => {
    mocks.findById.mockResolvedValue(existing())
    mocks.update.mockResolvedValue(0)

    await expectRejectCode(service.update(user(), 'coop-1', { goal: 'Новая цель' }), 'CONFLICT')
    expect(mocks.update).toHaveBeenCalledWith('coop-1', 'ACTIVE', expect.objectContaining({ goal: 'Новая цель' }))
  })
})
