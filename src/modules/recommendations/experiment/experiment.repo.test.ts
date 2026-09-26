import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `saveOutcomes` (решение 190, ревью базы): раньше исходы сигналов писались
 * циклом — `await` на `updateMany` каждой записи по очереди, отдельным
 * круговым обращением к базе на каждую. Теперь все обновления уходят одним
 * пакетом `$transaction`. Условие записи (`outcomeAt: null` — не переписывать
 * уже решённый исход) и данные каждого обновления не изменились.
 */
const db = vi.hoisted(() => {
  const recommendationSignal = { updateMany: vi.fn(async () => ({ count: 1 })) }
  const prisma = {
    recommendationSignal,
    $transaction: vi.fn(async (arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : arg)),
  }
  return { prisma, recommendationSignal }
})

vi.mock('@/shared/db/prisma', () => ({ prisma: db.prisma }))

const repo = await import('./experiment.repo')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('saveOutcomes: пакетная запись через $transaction', () => {
  it('без обновлений — не открывает транзакцию вовсе', async () => {
    await repo.saveOutcomes([])
    expect(db.prisma.$transaction).not.toHaveBeenCalled()
    expect(db.recommendationSignal.updateMany).not.toHaveBeenCalled()
  })

  it('несколько исходов — один $transaction на все updateMany, а не цикл await', async () => {
    const evaluatedAt = new Date('2026-09-27T10:00:00.000Z')
    await repo.saveOutcomes([
      { id: 's1', outcome: { state: 'success', days: 5, event: 'stage-advance', at: new Date('2026-09-20T00:00:00.000Z') }, evaluatedAt },
      { id: 's2', outcome: { state: 'failure', days: null, event: null, at: null }, evaluatedAt },
    ])

    expect(db.prisma.$transaction).toHaveBeenCalledTimes(1)
    const arg = db.prisma.$transaction.mock.calls[0]![0]
    expect(Array.isArray(arg)).toBe(true)
    expect(arg).toHaveLength(2)

    expect(db.recommendationSignal.updateMany).toHaveBeenCalledTimes(2)
    expect(db.recommendationSignal.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', outcomeAt: null },
      data: {
        outcomeAt: new Date('2026-09-20T00:00:00.000Z'),
        outcome: {
          state: 'success',
          days: 5,
          event: 'stage-advance',
          at: '2026-09-20T00:00:00.000Z',
          evaluatedAt: evaluatedAt.toISOString(),
        },
      },
    })
    expect(db.recommendationSignal.updateMany).toHaveBeenCalledWith({
      where: { id: 's2', outcomeAt: null },
      data: {
        outcomeAt: null,
        outcome: { state: 'failure', days: null, event: null, at: null, evaluatedAt: evaluatedAt.toISOString() },
      },
    })
  })
})
