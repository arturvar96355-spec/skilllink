import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { TimelineRow } from './stage-analytics.repo'

/**
 * Кеш хронологий связок для воронки и когорт (решение 190, ревью базы — тот же
 * приём, что sharedInsights в pulse.extras.ts, решение 120). Воронка и когорты
 * оба читают repo.findTimelineRows(scope) — без кеша это два одинаковых полных
 * запроса связок с их этапами и историей подряд на одном открытии страницы
 * аналитики. Здесь база подменена: важно не то, что именно посчитано (формулы
 * проверены в stage-analytics.test.ts на чистых функциях), а сколько раз
 * вызывается repo.findTimelineRows.
 */

const repo = vi.hoisted(() => ({
  findTimelineRows: vi.fn(async (_scope: { universityId?: string }) => [] as TimelineRow[]),
}))

vi.mock('./stage-analytics.repo', () => repo)

const { funnel, cohorts } = await import('./stage-analytics.service')

function user(): CurrentUser {
  return { id: 'u-1', email: 'analyst@example.invalid', fullName: 'Аналитик', role: 'ANALYST', universityId: null }
}

const row = (id: string): TimelineRow =>
  ({
    id,
    status: 'ACTIVE',
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    closedAt: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    isMock: false,
    university: { id: 'univ-1', name: 'Университет', shortName: null, region: 'Регион', city: 'Город' },
    program: { id: 'prog-1', name: 'Программа', level: 'BACHELOR' },
    product: null,
    stages: [
      {
        stageNumber: 1,
        status: 'IN_PROGRESS',
        completedAt: null,
        history: [{ toStatus: 'IN_PROGRESS', changedAt: new Date('2026-01-01T00:00:00.000Z') }],
      },
    ],
  }) as unknown as TimelineRow

beforeEach(() => {
  vi.clearAllMocks()
  repo.findTimelineRows.mockResolvedValue([row('coop-1')])
})

// Кеш живёт на уровне модуля (не на уровне теста): каждому тесту — своя база
// времени, разнесённая больше чем на TTL от других, иначе запись, оставленная
// одним тестом, тихо обслужила бы вызов другого.
const HOUR_MS = 60 * 60 * 1000
const baseAt = (hoursFromEpochStart: number) => new Date(Date.UTC(2026, 0, 1) + hoursFromEpochStart * HOUR_MS)

describe('кеш хронологий связок (funnel/cohorts)', () => {
  it('funnel и cohorts подряд с той же областью видимости — один запрос к базе, не два', async () => {
    const now = baseAt(1)
    await funnel(user(), {}, now)
    await cohorts(user(), now)

    expect(repo.findTimelineRows).toHaveBeenCalledTimes(1)
  })

  it('за пределами минуты — запрос повторяется', async () => {
    const now = baseAt(2)
    await funnel(user(), {}, now)
    await funnel(user(), {}, new Date(now.getTime() + 60_001))

    expect(repo.findTimelineRows).toHaveBeenCalledTimes(2)
  })

  it('без права ANALYTICS — отказ до обращения к базе, кеш не трогается', async () => {
    const viewer: CurrentUser = { ...user(), role: 'UNIVERSITY_REP', universityId: 'univ-1' }
    await expect(funnel(viewer, {}, baseAt(3))).rejects.toThrow()
    expect(repo.findTimelineRows).not.toHaveBeenCalled()
  })
})
