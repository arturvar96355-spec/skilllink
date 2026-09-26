import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `findUniversityDomains` (решение 190, ревью базы): опознание вуза по домену
 * письма читало все действующие вузы вместе с контактами при каждом входящем
 * письме. Кеш на минуту без ключа по области видимости — опознание не завязано
 * на роль или вуз того, кто разбирает письмо, домены одни на всё приложение.
 * Сама выдача (домены сайта + домены почт контактов) не изменилась.
 */
const db = vi.hoisted(() => ({
  university: { findMany: vi.fn() },
}))

vi.mock('@/shared/db/prisma', () => ({ prisma: db }))

const repo = await import('./inbound-letters.repo')

beforeEach(() => {
  vi.clearAllMocks()
  db.university.findMany.mockResolvedValue([
    { id: 'univ-1', website: 'https://spbstu.ru', contacts: [{ email: 'rector@spbstu.ru' }, { email: null }] },
  ])
})

const HOUR_MS = 60 * 60 * 1000
const baseAt = (hoursFromEpochStart: number) => new Date(Date.UTC(2026, 0, 1) + hoursFromEpochStart * HOUR_MS)

describe('findUniversityDomains: кеш на минуту', () => {
  it('два вызова подряд в пределах минуты — один запрос к базе', async () => {
    const now = baseAt(1)
    await repo.findUniversityDomains(now)
    await repo.findUniversityDomains(new Date(now.getTime() + 30_000))

    expect(db.university.findMany).toHaveBeenCalledTimes(1)
  })

  it('за пределами минуты — запрос повторяется', async () => {
    const now = baseAt(2)
    await repo.findUniversityDomains(now)
    await repo.findUniversityDomains(new Date(now.getTime() + 60_001))

    expect(db.university.findMany).toHaveBeenCalledTimes(2)
  })

  it('выдача не изменилась: домен сайта и домены почт контактов', async () => {
    const result = await repo.findUniversityDomains(baseAt(3))
    expect(result).toEqual([{ universityId: 'univ-1', domains: ['spbstu.ru'] }])
  })
})
