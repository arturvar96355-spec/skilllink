import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * «Приоритетные действия» на главной (решение 206): пятёрка выбирается по
 * приоритету, внутри приоритета — по баллу, а не по дате создания; отложенные
 * защитой от перегрузки (`isDeferred`) и просрочки этапов (`stage.overdue`,
 * решение 180) в неё не попадают.
 *
 * Выборку делает база — здесь база подменена: запрос перехватывается, а его
 * условие и порядок применяются к набору записей так, как их применяет PostgreSQL
 * (перечисление приоритета — в порядке объявления, `nulls: 'last'` у балла).
 */
const db = vi.hoisted(() => ({ recommendation: { findMany: vi.fn() } }))
vi.mock('@/shared/db/prisma', () => ({ prisma: db }))

const repo = await import('./analytics.repo')

type Row = {
  id: string
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  status: 'NEW' | 'IN_PROGRESS' | 'DONE' | 'DISMISSED'
  ruleKey: string
  score: number | null
  isDeferred: boolean
  createdAt: Date
}

const PRIORITY_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 } as const

/** Условие и порядок запроса — к записям в памяти, как их понимает база. */
function applyQuery(rows: Row[], args: { where: Record<string, unknown>; orderBy: unknown[]; take: number }): Row[] {
  const where = args.where as {
    status: { in: string[] }
    ruleKey: { not: string }
    isDeferred: boolean
  }
  const filtered = rows.filter(
    (row) =>
      where.status.in.includes(row.status) && row.ruleKey !== where.ruleKey.not && row.isDeferred === where.isDeferred,
  )
  return filtered
    .sort(
      (a, b) =>
        PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
        (b.score ?? -1) - (a.score ?? -1) ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    )
    .slice(0, args.take)
}

const at = (day: number) => new Date(Date.UTC(2026, 8, day))
const ROWS: Row[] = [
  // Свежая, но с низким баллом: раньше попадала наверх по дате.
  { id: 'fresh-low', priority: 'HIGH', status: 'NEW', ruleKey: 'cooperation.no-product', score: 0.48, isDeferred: false, createdAt: at(26) },
  { id: 'k8s', priority: 'HIGH', status: 'NEW', ruleKey: 'skill.critical-gap-with-product', score: 0.63, isDeferred: false, createdAt: at(10) },
  { id: 'pg', priority: 'HIGH', status: 'NEW', ruleKey: 'skill.critical-gap-with-product', score: 0.63, isDeferred: false, createdAt: at(9) },
  { id: 'metrics', priority: 'HIGH', status: 'NEW', ruleKey: 'program.missing-metrics', score: 0.68, isDeferred: false, createdAt: at(2) },
  { id: 'mlops', priority: 'HIGH', status: 'IN_PROGRESS', ruleKey: 'skill.critical-gap-with-product', score: 0.62, isDeferred: false, createdAt: at(8) },
  { id: 'stalled', priority: 'HIGH', status: 'NEW', ruleKey: 'cooperation.stalled', score: 0.55, isDeferred: false, createdAt: at(1) },
  // Отложенная системой — с высоким баллом, но на главную не идёт.
  { id: 'deferred', priority: 'HIGH', status: 'NEW', ruleKey: 'cooperation.stalled', score: 0.9, isDeferred: true, createdAt: at(25) },
  // Просрочка этапа — в соседнем блоке, не здесь.
  { id: 'overdue', priority: 'CRITICAL', status: 'NEW', ruleKey: 'stage.overdue', score: 0.95, isDeferred: false, createdAt: at(20) },
  { id: 'medium', priority: 'MEDIUM', status: 'NEW', ruleKey: 'cooperation.stalled', score: 0.99, isDeferred: false, createdAt: at(27) },
  { id: 'closed', priority: 'HIGH', status: 'DONE', ruleKey: 'cooperation.stalled', score: 0.99, isDeferred: false, createdAt: at(27) },
  { id: 'no-score', priority: 'HIGH', status: 'NEW', ruleKey: 'cooperation.stalled', score: null, isDeferred: false, createdAt: at(27) },
]

beforeEach(() => {
  vi.clearAllMocks()
  db.recommendation.findMany.mockImplementation(async (args) => applyQuery(ROWS, args))
})

describe('выбор пятёрки «Приоритетных действий»', () => {
  it('по баллу внутри приоритета, а не по дате создания', async () => {
    const rows = (await repo.findPriorityRecommendations({}, 5)) as unknown as Row[]
    expect(rows.map((row) => row.id)).toEqual(['metrics', 'k8s', 'pg', 'mlops', 'stalled'])
  })

  it('отложенные системой и просрочки этапов не попадают', async () => {
    const rows = (await repo.findPriorityRecommendations({}, 20)) as unknown as Row[]
    const ids = rows.map((row) => row.id)
    expect(ids).not.toContain('deferred')
    expect(ids).not.toContain('overdue')
    expect(ids).not.toContain('closed')
  })

  it('приоритет главнее балла; запись без балла — в конце своего приоритета', async () => {
    const rows = (await repo.findPriorityRecommendations({}, 20)) as unknown as Row[]
    const ids = rows.map((row) => row.id)
    expect(ids.indexOf('no-score')).toBe(ids.lastIndexOf('no-score'))
    expect(ids.indexOf('no-score')).toBeLessThan(ids.indexOf('medium'))
    expect(ids.at(-1)).toBe('medium')
    expect(ids.at(-2)).toBe('no-score')
  })

  it('в запросе: без отложенных, балл — второй ключ сортировки, пустой балл последним', async () => {
    await repo.findPriorityRecommendations({ universityId: 'u1' }, 5)
    const args = db.recommendation.findMany.mock.calls[0]![0]
    expect(args.where).toMatchObject({ isDeferred: false, ruleKey: { not: 'stage.overdue' } })
    expect(args.where.cooperation).toEqual({ universityId: 'u1' })
    expect(args.orderBy[0]).toEqual({ priority: 'desc' })
    expect(args.orderBy[1]).toEqual({ score: { sort: 'desc', nulls: 'last' } })
    expect(args.take).toBe(5)
  })
})
