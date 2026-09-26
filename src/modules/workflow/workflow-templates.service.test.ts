import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/shared/http/errors'
import type { CurrentUser } from '@/shared/auth/current-user'

/**
 * Настройки → Workflow (ТЗ, функц. требования пп. 6, 9; решение 146): только
 * ADMIN, признак контрольной точки только для чтения с объяснением, правка
 * существующих связок — только по явному `applyToUnfinishedStages`.
 */
const repo = vi.hoisted(() => ({
  findAll: vi.fn(),
  findByNumber: vi.fn(),
  update: vi.fn(),
  applyToUnfinishedStages: vi.fn(),
}))
vi.mock('./workflow-templates.repo', () => repo)

const audit = vi.hoisted(() => ({ writeAudit: vi.fn() }))
vi.mock('@/shared/audit/audit', () => audit)

const service = await import('./workflow-templates.service')

function admin(): CurrentUser {
  return { id: 'admin-1', email: 'admin@skilllink.demo', fullName: 'Админ', role: 'ADMIN', universityId: null }
}
function manager(): CurrentUser {
  return { id: 'mgr-1', email: 'manager@skilllink.demo', fullName: 'Менеджер', role: 'MANAGER', universityId: null }
}

const ROW = {
  id: 'tpl-1',
  stageNumber: 6,
  title: 'Подписание документов',
  phase: 'FORMALIZATION' as const,
  normativeDays: 63,
  isControlPoint: true,
  defaultTasks: [{ title: 'Документы подписаны', isRequired: true }],
  updatedAt: new Date('2026-09-26T00:00:00.000Z'),
  updatedBy: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.findAll.mockResolvedValue([ROW])
  repo.findByNumber.mockResolvedValue(ROW)
  repo.update.mockResolvedValue({ ...ROW, title: 'Новое название' })
  repo.applyToUnfinishedStages.mockResolvedValue(0)
})

describe('getSettings', () => {
  it('только ADMIN', async () => {
    await expect(service.getSettings(manager())).rejects.toThrow(AppError)
    await expect(service.getSettings(admin())).resolves.toBeTruthy()
  })

  it('объясняет контрольную точку и не объясняет обычный этап', async () => {
    const result = await service.getSettings(admin())
    expect(result.stages[0]?.isControlPoint).toBe(true)
    expect(result.stages[0]?.controlPointExplanation).toContain('решения 5/28')

    repo.findAll.mockResolvedValue([{ ...ROW, isControlPoint: false }])
    const notControl = await service.getSettings(admin())
    expect(notControl.stages[0]?.controlPointExplanation).toBeNull()
  })
})

describe('patchStage', () => {
  it('только ADMIN', async () => {
    await expect(service.patchStage(manager(), 6, { title: 'X' })).rejects.toThrow(AppError)
  })

  it('этап не найден — NOT_FOUND', async () => {
    repo.findByNumber.mockResolvedValue(null)
    await expect(service.patchStage(admin(), 99, { title: 'X' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('без applyToUnfinishedStages существующие связки не трогаются', async () => {
    const result = await service.patchStage(admin(), 6, { title: 'Новое название' })
    expect(repo.applyToUnfinishedStages).not.toHaveBeenCalled()
    expect(result.appliedToStages).toBe(0)
    expect(audit.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'workflow_template.update' }),
    )
  })

  it('с applyToUnfinishedStages вызывает пересчёт и возвращает число изменённых', async () => {
    repo.applyToUnfinishedStages.mockResolvedValue(3)
    const result = await service.patchStage(admin(), 6, {
      normativeDays: 70,
      applyToUnfinishedStages: true,
    })
    expect(repo.applyToUnfinishedStages).toHaveBeenCalledWith(6, { title: undefined, normativeDays: 70 })
    expect(result.appliedToStages).toBe(3)
  })

  it('значение не меняется (то же название) — обновление и журнал не пишутся', async () => {
    await service.patchStage(admin(), 6, { title: ROW.title })
    expect(repo.update).not.toHaveBeenCalled()
    expect(audit.writeAudit).not.toHaveBeenCalled()
  })
})
