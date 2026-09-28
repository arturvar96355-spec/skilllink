import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { StageStatus } from '@/shared/contracts/enums'
import type { TimelineRow } from './stage-analytics.repo'

/**
 * Ответ `GET /api/analytics/funnel` (решение 227): сводка выбывших считается сервером
 * по всем выбывшим, список `steps[].dropped` — превью до 20 на шаг. Раньше интерфейс
 * считал «на паузе / отменены» по превью, и части не сходились с итогом.
 */

const repo = vi.hoisted(() => ({
  findTimelineRows: vi.fn(async (_scope: { universityId?: string }) => [] as unknown[]),
  findCooperationUpdates: vi.fn(async (_ids: readonly string[]) => [] as unknown[]),
}))

vi.mock('./stage-analytics.repo', () => repo)

const { funnel } = await import('./stage-analytics.service')

const NOW = new Date('2026-09-28T12:00:00.000Z')
const T0 = new Date('2026-03-01T09:00:00.000Z')
const at = (days: number) => new Date(T0.getTime() + days * 86_400_000)

const analyst: CurrentUser = {
  id: 'u-1',
  email: 'analyst@example.invalid',
  fullName: 'Аналитик',
  role: 'ANALYST',
  universityId: null,
}

/** Связка: этапы 1..13, `closes` — [этап, день, статус]; без статуса — завершён. */
function row(
  id: string,
  status: TimelineRow['status'],
  closes: Array<[number, number, StageStatus?]>,
): TimelineRow {
  const stages = Array.from({ length: 13 }, (_, index) => {
    const number = index + 1
    const history = closes
      .filter(([stage]) => stage === number)
      .map(([, day, to]) => ({ toStatus: to ?? ('COMPLETED' as StageStatus), changedAt: at(day) }))
    const last = history.at(-1)
    return {
      stageNumber: number,
      status: last?.toStatus ?? ('NOT_STARTED' as StageStatus),
      completedAt: last?.toStatus === 'COMPLETED' ? last.changedAt : null,
      history,
    }
  })
  return {
    id,
    status,
    startedAt: T0,
    createdAt: T0,
    closedAt: status === 'CANCELLED' ? at(40) : null,
    updatedAt: at(40),
    isMock: true,
    notes: null,
    university: { id: 'u', name: 'Университет', shortName: 'У', region: 'Москва', city: 'Москва' },
    program: { id: `p-${id}`, name: `Программа ${id}`, level: 'BACHELOR' },
    product: { id: 'pr', name: 'Продукт' },
    stages,
  } as unknown as TimelineRow
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('воронка: сводка выбывших на сервере (решение 227)', () => {
  it('25 выбывших на одном шаге: агрегаты считают все 25, превью — 20', async () => {
    repo.findTimelineRows.mockResolvedValue([
      // Отменены на этапе 2 (этап 2 отменён — остановка на нём, решение 227).
      ...Array.from({ length: 15 }, (_, index) => row(`c${String(index).padStart(2, '0')}`, 'CANCELLED', [[1, 1], [2, 5, 'CANCELLED']])),
      // На паузе на этапе 2.
      ...Array.from({ length: 10 }, (_, index) => row(`p${String(index).padStart(2, '0')}`, 'PAUSED', [[1, 1]])),
      // На паузе на этапе 7 — фаза «Внедрение»; этап 5 отменён как ненужный.
      row('late', 'PAUSED', [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5, 'CANCELLED'], [6, 6]]),
      // В работе — не выбывшая.
      row('active', 'ACTIVE', [[1, 1], [2, 2]]),
    ])

    const result = await funnel(analyst, {}, NOW)
    const stage2 = result.steps.find((step) => step.key === 'stage-2')!
    expect(stage2.droppedCount).toBe(25)
    expect(stage2.dropped).toHaveLength(20)

    expect(result.droppedByStatus).toEqual({ PAUSED: 11, CANCELLED: 15 })
    expect(result.droppedByPhase).toEqual({
      ATTRACTION: 25,
      FORMALIZATION: 0,
      IMPLEMENTATION: 1,
      OPERATION: 0,
      CONTROL: 0,
    })
    const droppedTotal = result.steps.reduce((sum, step) => sum + step.droppedCount, 0)
    expect(result.droppedByStatus.PAUSED + result.droppedByStatus.CANCELLED).toBe(droppedTotal)
    expect(Object.values(result.droppedByPhase).reduce((sum, count) => sum + count, 0)).toBe(droppedTotal)

    // Превью — со строкой «где выбыла» из того же расчёта, что и сводка по фазам.
    const preview = result.steps.flatMap((step) => step.dropped)
    expect(preview).toHaveLength(21)
    expect(preview.find((item) => item.cooperationId === 'late')).toMatchObject({ stageNumber: 7, phase: 'IMPLEMENTATION' })
    expect(preview.find((item) => item.cooperationId === 'c00')).toMatchObject({ stageNumber: 2, phase: 'ATTRACTION' })
    // Журнал читается только для строк превью, а не для всех выбывших.
    expect(repo.findCooperationUpdates).toHaveBeenCalledTimes(1)
    expect(repo.findCooperationUpdates.mock.calls[0]![0]).toHaveLength(21)
  })

  it('выбывших нет — агрегаты нулевые, по всем фазам', async () => {
    repo.findTimelineRows.mockResolvedValue([row('active', 'ACTIVE', [[1, 1]])])
    const result = await funnel(analyst, { milestones: true }, NOW)
    expect(result.droppedByStatus).toEqual({ PAUSED: 0, CANCELLED: 0 })
    expect(result.droppedByPhase).toEqual({ ATTRACTION: 0, FORMALIZATION: 0, IMPLEMENTATION: 0, OPERATION: 0, CONTROL: 0 })
  })
})
