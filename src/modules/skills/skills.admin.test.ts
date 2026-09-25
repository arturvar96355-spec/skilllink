import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { UserRole } from '@/shared/contracts/enums'
import { planSkillMerge } from './skills.rules'

/**
 * Управление справочником навыков (решение 107). Репозиторий и журнал подменены:
 * проверяется, кому разрешено, какие отказы и что уходит в журнал. Правила
 * объединения — в skills.test.ts, транзакция с базой — в пробнике.
 */
const mocks = vi.hoisted(() => ({
  createSkill: vi.fn(),
  updateSkill: vi.fn(),
  findById: vi.fn(),
  mergeInto: vi.fn(),
  deleteIfUnused: vi.fn(),
  writeAudit: vi.fn(),
}))

vi.mock('@/shared/db/prisma', () => ({ prisma: {} }))
vi.mock('@/shared/audit/audit', () => ({ writeAudit: mocks.writeAudit }))
vi.mock('./skills.repo', () => ({
  createSkill: mocks.createSkill,
  updateSkill: mocks.updateSkill,
  findById: mocks.findById,
  mergeInto: mocks.mergeInto,
  deleteIfUnused: mocks.deleteIfUnused,
}))

const service = await import('./skills.service')

const as = (role: UserRole): CurrentUser => ({
  id: 'me',
  email: 'me@skilllink.demo',
  fullName: 'Текущий',
  role,
  universityId: role === 'UNIVERSITY_REP' ? 'uni' : null,
})

const skillRow = (id: string, name: string) => ({
  id,
  name,
  category: 'Данные',
  description: null,
  _count: { programs: 2, products: 1 },
})

const noLinks = { programs: [], products: [], demand: [], recommendations: [] }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('права: справочник меняет только администратор', () => {
  for (const role of ['MANAGER', 'ANALYST', 'VIEWER', 'UNIVERSITY_REP'] as const) {
    it(`${role}: 403 на создание, правку, объединение и удаление, база не тронута`, async () => {
      const user = as(role)
      await expect(service.create(user, { name: 'Rust', category: 'Языки' })).rejects.toMatchObject({ status: 403 })
      await expect(service.update(user, 's1', { name: 'Rust' })).rejects.toMatchObject({ status: 403 })
      await expect(service.merge(user, 's1', { targetId: 's2' })).rejects.toMatchObject({ status: 403 })
      await expect(service.remove(user, 's1')).rejects.toMatchObject({ status: 403 })
      expect(mocks.createSkill).not.toHaveBeenCalled()
      expect(mocks.updateSkill).not.toHaveBeenCalled()
      expect(mocks.mergeInto).not.toHaveBeenCalled()
      expect(mocks.deleteIfUnused).not.toHaveBeenCalled()
    })
  }
})

describe('создание и правка', () => {
  it('дубль названия — 409 с найденным названием, в журнал не пишется', async () => {
    mocks.createSkill.mockResolvedValue({ ok: false, clash: { id: 'ml', name: 'Machine Learning' } })
    await expect(
      service.create(as('ADMIN'), { name: 'machine learning', category: 'Данные' }),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('«Machine Learning»') })
    expect(mocks.writeAudit).not.toHaveBeenCalled()
  })

  it('новый навык — в ответе DTO, в журнале название и категория', async () => {
    mocks.createSkill.mockResolvedValue({ ok: true, row: skillRow('s1', 'Rust') })
    const dto = await service.create(as('ADMIN'), { name: 'Rust', category: 'Данные' })
    expect(dto).toEqual({
      id: 's1',
      name: 'Rust',
      category: 'Данные',
      description: null,
      programCount: 2,
      productCount: 1,
    })
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'skill.create', objectType: 'Skill', objectId: 's1' }),
    )
  })

  it('переименование пишет в журнал старое и новое название', async () => {
    mocks.findById.mockResolvedValue(skillRow('s1', 'ML'))
    mocks.updateSkill.mockResolvedValue({ ok: true, row: skillRow('s1', 'Машинное обучение') })
    await service.update(as('ADMIN'), 's1', { name: 'Машинное обучение' })
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'skill.update',
        payload: { fields: ['name'], from: 'ML', to: 'Машинное обучение' },
      }),
    )
  })

  it('правка несуществующего — 404', async () => {
    mocks.findById.mockResolvedValue(null)
    await expect(service.update(as('ADMIN'), 'nope', { category: 'X' })).rejects.toMatchObject({ status: 404 })
  })
})

describe('объединение', () => {
  it('сам с собой — 422 по полю targetId, база не тронута', async () => {
    await expect(service.merge(as('ADMIN'), 's1', { targetId: 's1' })).rejects.toMatchObject({
      status: 422,
      details: [expect.objectContaining({ field: 'targetId' })],
    })
    expect(mocks.mergeInto).not.toHaveBeenCalled()
  })

  it('нет дубля — 404, нет целевого — 422 по targetId', async () => {
    mocks.mergeInto.mockResolvedValueOnce({ status: 'not-found', which: 'source' })
    await expect(service.merge(as('ADMIN'), 's1', { targetId: 's2' })).rejects.toMatchObject({ status: 404 })
    mocks.mergeInto.mockResolvedValueOnce({ status: 'not-found', which: 'target' })
    await expect(service.merge(as('ADMIN'), 's1', { targetId: 's2' })).rejects.toMatchObject({ status: 422 })
  })

  it('итог считает перенесённое и объединённое, журнал — на целевом навыке с именем удалённого', async () => {
    const plan = planSkillMerge(
      {
        ...noLinks,
        products: [{ id: 't-pr', productId: 'pr1', relevance: 'OPTIONAL' }],
      },
      {
        ...noLinks,
        products: [
          { id: 'd-pr', productId: 'pr1', relevance: 'CORE' },
          { id: 'd-pr2', productId: 'pr2', relevance: 'RELATED' },
        ],
      },
    )
    mocks.mergeInto.mockResolvedValue({
      status: 'merged',
      removed: { id: 's1', name: 'ML' },
      target: skillRow('s2', 'Машинное обучение'),
      plan,
    })

    const result = await service.merge(as('ADMIN'), 's1', { targetId: 's2' })

    expect(result.removed).toEqual({ id: 's1', name: 'ML' })
    expect(result.products).toEqual({ moved: 1, combined: 1 })
    expect(result.programs).toEqual({ moved: 0, combined: 0 })
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'skill.merge',
        objectId: 's2',
        payload: expect.objectContaining({ removedId: 's1', removedName: 'ML' }),
      }),
    )
  })
})

describe('удаление', () => {
  it('используемый навык — 409 с объяснением и счётчиками, в журнал не пишется', async () => {
    const usage = { programs: 3, products: 0, demand: 8, recommendations: 0 }
    mocks.deleteIfUnused.mockResolvedValue({ usage, name: 'Python' })
    await expect(service.remove(as('ADMIN'), 's1')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('в 3 программах'),
      details: { usage },
    })
    expect(mocks.writeAudit).not.toHaveBeenCalled()
  })

  it('неиспользуемый удаляется и попадает в журнал с названием', async () => {
    mocks.deleteIfUnused.mockResolvedValue({ deleted: { id: 's1', name: 'Rust' } })
    expect(await service.remove(as('ADMIN'), 's1')).toEqual({ id: 's1', name: 'Rust' })
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'skill.delete', objectId: 's1', payload: { name: 'Rust' } }),
    )
  })

  it('нет навыка — 404', async () => {
    mocks.deleteIfUnused.mockResolvedValue(null)
    await expect(service.remove(as('ADMIN'), 'nope')).rejects.toMatchObject({ status: 404 })
  })
})
