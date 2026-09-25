import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ruleCriticalGapWithProduct } from '@/modules/recommendations/recommendations.rules'

/**
 * Репозиторий справочника навыков с подменённой базой (решение 110): что делает код,
 * когда уникальность держит индекс `skills_name_key_ci`, и что пишется в рекомендации
 * при объединении и переименовании. Настоящая база и гонка запросов — в пробнике.
 */
const db = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    skill: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), delete: vi.fn() },
    programSkill: { findMany: vi.fn(), update: vi.fn(), delete: vi.fn(), updateMany: vi.fn() },
    productSkill: { findMany: vi.fn(), update: vi.fn(), delete: vi.fn(), updateMany: vi.fn() },
    marketDemand: { findMany: vi.fn(), update: vi.fn(), delete: vi.fn(), updateMany: vi.fn() },
    recommendation: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  }
  const prisma = {
    skill: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async (action: (client: typeof tx) => Promise<unknown>) => action(tx)),
  }
  return { tx, prisma }
})

vi.mock('@/shared/db/prisma', () => ({ prisma: db.prisma }))

const repo = await import('./skills.repo')

const uniqueViolation = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
const row = (id: string, name: string) => ({
  id,
  name,
  category: 'Данные',
  description: null,
  _count: { programs: 0, products: 0 },
})

/** Рекомендация правила 3 в том виде, в каком её сохранила генерация. */
function gapRecommendation(id: string, skillId: string, skillName: string) {
  const draft = ruleCriticalGapWithProduct({
    skillId,
    skillName,
    demandNormalized: 0.9,
    products: [{ id: 'p1', name: 'Облачная платформа РТК', relevance: 'CORE' }],
    programs: [{ id: 'g1', name: 'DevOps', universityName: 'КНИТУ-КАИ' }],
  })!
  return { id, ruleKey: draft.ruleKey, title: draft.title, description: draft.description, relatedData: draft.relatedData }
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const table of Object.values(db.tx)) {
    if (typeof table === 'object') for (const fn of Object.values(table)) fn.mockResolvedValue([])
  }
})

describe('уникальность названия держит база', () => {
  it('гонка: проверка пропустила, индекс отказал — 409-исход с названием соперника', async () => {
    db.prisma.skill.findMany
      .mockResolvedValueOnce([]) // проверка до записи: соперника ещё нет
      .mockResolvedValueOnce([{ id: 'py', name: 'Python' }]) // после отказа индекса
    db.prisma.skill.create.mockRejectedValue(uniqueViolation)

    expect(await repo.createSkill({ name: 'python', category: 'Языки' })).toEqual({
      ok: false,
      clash: { id: 'py', name: 'Python' },
    })
  })

  it('соперник уже исчез — называется введённое название, а не 500', async () => {
    db.prisma.skill.findMany.mockResolvedValue([])
    db.prisma.skill.create.mockRejectedValue(uniqueViolation)
    expect(await repo.createSkill({ name: 'Rust', category: 'Языки' })).toEqual({
      ok: false,
      clash: { id: '', name: 'Rust' },
    })
  })

  it('другая ошибка базы не выдаётся за дубль', async () => {
    db.prisma.skill.findMany.mockResolvedValue([])
    db.prisma.skill.create.mockRejectedValue(Object.assign(new Error('fk'), { code: 'P2003' }))
    await expect(repo.createSkill({ name: 'Rust', category: 'Языки' })).rejects.toMatchObject({ code: 'P2003' })
  })

  it('дубль виден до записи — запись не выполняется', async () => {
    db.prisma.skill.findMany.mockResolvedValue([{ id: 'ml', name: 'MLOps' }])
    expect(await repo.createSkill({ name: 'ML Ops', category: 'Данные' })).toEqual({
      ok: false,
      clash: { id: 'ml', name: 'MLOps' },
    })
    expect(db.prisma.skill.create).not.toHaveBeenCalled()
  })

  it('переименование под гонку — тот же исход', async () => {
    db.prisma.skill.findUnique.mockResolvedValue({ id: 's1' })
    db.prisma.skill.findMany
      .mockResolvedValueOnce([{ id: 's1', name: 'ML' }])
      .mockResolvedValueOnce([{ id: 's1', name: 'ML' }, { id: 's2', name: 'MLOps' }])
    db.prisma.$transaction.mockRejectedValueOnce(uniqueViolation)

    expect(await repo.updateSkill('s1', { name: 'ML Ops' })).toEqual({
      ok: false,
      clash: { id: 's2', name: 'MLOps' },
    })
  })
})

describe('рекомендации называют навык по-новому в той же транзакции', () => {
  it('переименование переписывает заголовок и описание', async () => {
    db.prisma.skill.findUnique.mockResolvedValue({ id: 's1' })
    db.prisma.skill.findMany.mockResolvedValue([{ id: 's1', name: 'ML' }])
    db.tx.skill.update.mockResolvedValue(row('s1', 'Машинное обучение'))
    db.tx.recommendation.findMany.mockResolvedValue([gapRecommendation('r1', 's1', 'ML')])

    await repo.updateSkill('s1', { name: 'Машинное обучение' })

    expect(db.tx.recommendation.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: expect.objectContaining({
        title: 'Дефицит навыка «Машинное обучение» закрывается нашим продуктом',
        description: expect.stringContaining('продукт даёт навык «Машинное обучение», '),
      }),
    })
  })

  it('рекомендация без relatedData: правится текст, поле не пишется', async () => {
    db.prisma.skill.findUnique.mockResolvedValue({ id: 's1' })
    db.prisma.skill.findMany.mockResolvedValue([{ id: 's1', name: 'ML' }])
    db.tx.skill.update.mockResolvedValue(row('s1', 'MLOps'))
    db.tx.recommendation.findMany.mockResolvedValue([{ ...gapRecommendation('r1', 's1', 'ML'), relatedData: null }])

    await repo.updateSkill('s1', { name: 'MLOps' })

    const [[{ data }]] = db.tx.recommendation.update.mock.calls as [[{ data: Record<string, unknown> }]]
    expect(data.title).toBe('Дефицит навыка «MLOps» закрывается нашим продуктом')
    expect(data).not.toHaveProperty('relatedData')
  })

  it('правка без названия рекомендации не трогает', async () => {
    db.prisma.skill.findUnique.mockResolvedValue({ id: 's1' })
    db.tx.skill.update.mockResolvedValue(row('s1', 'ML'))
    await repo.updateSkill('s1', { category: 'Данные' })
    expect(db.tx.recommendation.findMany).not.toHaveBeenCalled()
    expect(db.prisma.skill.findMany).not.toHaveBeenCalled()
  })

  it('объединение: перенесённая рекомендация называет целевой навык и ссылается на него', async () => {
    db.tx.skill.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'dup' ? { id: 'dup', name: 'ML Ops' } : where.id === 'target' ? { id: 'target', name: 'MLOps' } : null,
    )
    db.tx.recommendation.findMany.mockImplementation(
      async ({ where, select }: { where: { objectId: string }; select: Record<string, boolean> }) => {
        // Сбор связей до переноса: у дубля одна рекомендация, у целевого нет.
        if (!select.title) return where.objectId === 'dup' ? [{ id: 'r1', ruleKey: 'skill.critical-gap-with-product' }] : []
        // После переноса запись уже у целевого навыка, текст — прежний.
        return where.objectId === 'target' ? [gapRecommendation('r1', 'dup', 'ML Ops')] : []
      },
    )

    const outcome = await repo.mergeInto('dup', 'target')

    expect(outcome.status).toBe('merged')
    expect(db.tx.recommendation.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['r1'] } },
      data: { objectId: 'target' },
    })
    expect(db.tx.recommendation.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: {
        title: 'Дефицит навыка «MLOps» закрывается нашим продуктом',
        description: expect.stringContaining('продукт даёт навык «MLOps», '),
        relatedData: expect.objectContaining({ skillId: 'target' }),
      },
    })
    // Текст переписан до удаления дубля — в одной транзакции.
    const renamedAt = db.tx.recommendation.update.mock.invocationCallOrder[0]!
    const deletedAt = db.tx.skill.delete.mock.invocationCallOrder[0]!
    expect(renamedAt).toBeLessThan(deletedAt)
  })
})
