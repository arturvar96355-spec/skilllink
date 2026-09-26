import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'

/**
 * Кеш рейтинга вузов (решение 190, ревью базы — тот же приём, что sharedInsights
 * в pulse.extras.ts, решение 120): реестр вузов запрашивает полный рейтинг при
 * каждом открытии страницы и при каждой фильтрации/сортировке по нему
 * (universities.service.ts), а расчёт — по всей выборке действующих программ.
 */

const repo = vi.hoisted(() => ({
  findProgramsForUniversityRating: vi.fn(
    async (_scope: { universityId?: string }) =>
      [] as Array<{
        id: string
        name: string
        universityId: string
        applicationCount: number | null
        studentCount: number | null
        groupCount: number | null
        metricsSource: string | null
      }>,
  ),
}))

vi.mock('./analytics.repo', () => repo)

const { universityRatings } = await import('./analytics.service')

function user(): CurrentUser {
  return { id: 'u-1', email: 'analyst@example.invalid', fullName: 'Аналитик', role: 'ANALYST', universityId: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.findProgramsForUniversityRating.mockResolvedValue([
    {
      id: 'prog-1',
      name: 'Программа',
      universityId: 'univ-1',
      applicationCount: 10,
      studentCount: 20,
      groupCount: 2,
      metricsSource: 'MANUAL',
    },
  ])
})

const HOUR_MS = 60 * 60 * 1000
const baseAt = (hoursFromEpochStart: number) => new Date(Date.UTC(2026, 0, 1) + hoursFromEpochStart * HOUR_MS)

describe('universityRatings: кеш на минуту, ключ по области видимости', () => {
  it('два вызова подряд в пределах минуты — один запрос к базе', async () => {
    const now = baseAt(1)
    await universityRatings(user(), now)
    await universityRatings(user(), new Date(now.getTime() + 30_000))

    expect(repo.findProgramsForUniversityRating).toHaveBeenCalledTimes(1)
  })

  it('за пределами минуты — запрос повторяется', async () => {
    const now = baseAt(2)
    await universityRatings(user(), now)
    await universityRatings(user(), new Date(now.getTime() + 60_001))

    expect(repo.findProgramsForUniversityRating).toHaveBeenCalledTimes(2)
  })

  it('результат содержит рейтинг по вузу из загруженных программ', async () => {
    const result = await universityRatings(user(), baseAt(3))
    expect(result.has('univ-1')).toBe(true)
  })
})
