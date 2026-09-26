import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { UserRole } from '@/shared/contracts/enums'
import { DUPLICATES } from '@/shared/config/data-quality.config'

/**
 * Сервис качества данных с подменённой базой: права, скрытие «не дубль», выбор
 * источника кандидатов, журнал. Настоящая база — в пробнике (checkDataQuality).
 */
const mocks = vi.hoisted(() => ({
  loadUniversities: vi.fn(),
  loadSkills: vi.fn(),
  loadPrograms: vi.fn(),
  loadProducts: vi.fn(),
  hasTrigramExtension: vi.fn(),
  trigramCandidatePairs: vi.fn(),
  findDismissedKeys: vi.fn(),
  countExisting: vi.fn(),
  upsertDismissal: vi.fn(),
  loadReportInput: vi.fn(),
  writeAudit: vi.fn(),
}))

vi.mock('@/shared/db/prisma', () => ({ prisma: {} }))
vi.mock('@/shared/audit/audit', () => ({ writeAudit: mocks.writeAudit }))
vi.mock('./data-quality.repo', () => {
  const { writeAudit: _unused, ...repo } = mocks
  return repo
})

const service = await import('./data-quality.service')

const as = (role: UserRole): CurrentUser => ({
  id: 'me',
  email: 'me@skilllink.demo',
  fullName: 'Текущий',
  role,
  universityId: role === 'UNIVERSITY_REP' ? 'uni' : null,
})

const SKILLS = [
  { id: 'a', name: 'JavaScript', category: 'Языки' },
  { id: 'b', name: 'JS', category: 'Языки' },
  { id: 'c', name: 'Kubernetes', category: 'DevOps' },
  { id: 'd', name: 'K8s', category: 'DevOps' },
]

const query = { entity: 'skill' as const, threshold: 0.4, includeDismissed: undefined, includeArchived: undefined }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.loadSkills.mockResolvedValue(SKILLS)
  mocks.loadUniversities.mockResolvedValue([])
  mocks.loadPrograms.mockResolvedValue([])
  mocks.loadProducts.mockResolvedValue([])
  mocks.findDismissedKeys.mockResolvedValue(new Set())
  mocks.hasTrigramExtension.mockResolvedValue(true)
  mocks.loadReportInput.mockResolvedValue({ universities: [], programs: [], skills: [], products: [], cooperations: [] })
})

describe('права', () => {
  it('представитель вуза: 403 на дубли, отчёт и «не дубль», база не тронута', async () => {
    const rep = as('UNIVERSITY_REP')
    await expect(service.findDuplicates(rep, query)).rejects.toMatchObject({ status: 403 })
    await expect(service.report(rep)).rejects.toMatchObject({ status: 403 })
    await expect(service.dismiss(rep, { entity: 'skill', firstId: 'a', secondId: 'b' })).rejects.toMatchObject({ status: 403 })
    expect(mocks.loadSkills).not.toHaveBeenCalled()
    expect(mocks.upsertDismissal).not.toHaveBeenCalled()
  })

  it('аналитик и наблюдатель смотрят, но «не дубль» не отмечают', async () => {
    for (const role of ['ANALYST', 'VIEWER'] as const) {
      await expect(service.findDuplicates(as(role), query)).resolves.toBeDefined()
      await expect(service.dismiss(as(role), { entity: 'skill', firstId: 'a', secondId: 'b' })).rejects.toMatchObject({ status: 403 })
    }
  })
})

describe('поиск дублей', () => {
  it('небольшой справочник — все со всеми, база кандидатов не спрашивается', async () => {
    const { data, meta } = await service.findDuplicates(as('MANAGER'), query)
    expect(data.map((pair) => [pair.a.name, pair.b.name])).toEqual([
      ['JavaScript', 'JS'],
      ['Kubernetes', 'K8s'],
    ])
    expect(meta).toMatchObject({ candidateSource: 'all-pairs', compared: 4, total: 2, dismissedHidden: 0 })
    expect(mocks.trigramCandidatePairs).not.toHaveBeenCalled()
    expect(data[0]!.a).toMatchObject({ hint: 'Языки', href: '/settings' })
  })

  it('«не дубль» скрыт, с includeDismissed — показан с признаком', async () => {
    mocks.findDismissedKeys.mockResolvedValue(new Set(['c|d']))
    const hidden = await service.findDuplicates(as('MANAGER'), query)
    expect(hidden.data).toHaveLength(1)
    expect(hidden.meta.dismissedHidden).toBe(1)
    const shown = await service.findDuplicates(as('MANAGER'), { ...query, includeDismissed: true })
    expect(shown.data.find((pair) => pair.a.id === 'c')!.dismissed).toBe(true)
  })

  it('большой справочник — кандидаты из pg_trgm плюс блокировка по синонимам', async () => {
    const many = Array.from({ length: DUPLICATES.allPairsLimit + 1 }, (_, index) => ({
      id: `z${String(index).padStart(5, '0')}`,
      name: `Навык ${index}`,
      category: 'Разное',
    }))
    mocks.loadSkills.mockResolvedValue([...SKILLS, ...many])
    mocks.trigramCandidatePairs.mockResolvedValue([])
    const { data, meta } = await service.findDuplicates(as('ANALYST'), query)
    expect(meta.candidateSource).toBe('pg_trgm')
    expect(mocks.trigramCandidatePairs).toHaveBeenCalledWith('skill', 0.4, false)
    // Синонимы триграммы не видят, их даёт блокировка по каноническому ключу.
    expect(data.map((pair) => pair.b.name)).toEqual(['JS', 'K8s'])
  })

  it(
    'без расширения pg_trgm большой справочник всё равно сравнивается в приложении',
    async () => {
      mocks.hasTrigramExtension.mockResolvedValue(false)
      mocks.loadSkills.mockResolvedValue([
        ...SKILLS,
        ...Array.from({ length: DUPLICATES.allPairsLimit }, (_, index) => ({ id: `y${index}`, name: `Q${index}x`, category: 'Разное' })),
      ])
      const { meta } = await service.findDuplicates(as('ANALYST'), { ...query, threshold: 0.99 })
      expect(meta.candidateSource).toBe('all-pairs')
      expect(mocks.trigramCandidatePairs).not.toHaveBeenCalled()
    },
    // Больше 1500 записей «все со всеми» — больше миллиона пар: без pg_trgm это и в жизни
    // медленно (решение 134 предполагает малый справочник), таймаут теста увеличен, а не код.
    20_000,
  )
})

describe('«не дубль»', () => {
  const saved = (created: boolean) => ({
    created,
    row: {
      id: 'dd1',
      entity: 'skill',
      firstId: 'a',
      secondId: 'b',
      comment: null,
      createdAt: new Date('2026-09-25T10:00:00Z'),
      dismissedBy: { id: 'me', fullName: 'Текущий', role: 'MANAGER' },
    },
  })

  it('пара сохраняется упорядоченной, в журнал — один раз', async () => {
    mocks.countExisting.mockResolvedValue(2)
    mocks.upsertDismissal.mockResolvedValue(saved(true))
    const result = await service.dismiss(as('MANAGER'), { entity: 'skill', firstId: 'b', secondId: 'a' })
    expect(mocks.upsertDismissal).toHaveBeenCalledWith(expect.objectContaining({ firstId: 'a', secondId: 'b' }))
    expect(result).toMatchObject({ id: 'dd1', createdAt: '2026-09-25T10:00:00.000Z' })
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'duplicate.dismiss', objectType: 'DuplicateDismissal', payload: { entity: 'skill', firstId: 'a', secondId: 'b' } }),
    )

    mocks.upsertDismissal.mockResolvedValue(saved(false))
    await service.dismiss(as('MANAGER'), { entity: 'skill', firstId: 'a', secondId: 'b' })
    expect(mocks.writeAudit).toHaveBeenCalledTimes(1)
  })

  it('несуществующая запись — 422, ничего не сохраняется', async () => {
    mocks.countExisting.mockResolvedValue(1)
    await expect(service.dismiss(as('ADMIN'), { entity: 'skill', firstId: 'a', secondId: 'нет' })).rejects.toMatchObject({ status: 422 })
    expect(mocks.upsertDismissal).not.toHaveBeenCalled()
  })
})

describe('отчёт', () => {
  it('считает дубли по всем четырём сущностям, без отмеченных «не дубль»', async () => {
    mocks.findDismissedKeys.mockImplementation(async (entity: string) => (entity === 'skill' ? new Set(['a|b']) : new Set()))
    const report = await service.report(as('VIEWER'))
    expect(report.duplicates).toEqual({ university: 0, skill: 1, program: 0, product: 0 })
  })
})
