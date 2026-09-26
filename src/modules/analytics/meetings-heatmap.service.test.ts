import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'

/**
 * Тепловая карта встреч (решение 190, ревью базы): без явного `from` запрос
 * раньше выгружал всю историю встреч с начала данных. Теперь по умолчанию —
 * последние 12 месяцев до `to` (MEETINGS_HEATMAP.defaultRangeDays,
 * data-quality.config.ts), а явный `from` работает как раньше.
 */

const repo = vi.hoisted(() => ({
  findHeldMeetings: vi.fn(async (_filter: { universityId?: string }, _from: Date | null, _to: Date) => [] as Array<{
    date: Date
    isMock: boolean
  }>),
}))

vi.mock('./meetings-heatmap.repo', () => repo)

const { meetingsHeatmap } = await import('./meetings-heatmap.service')

function user(): CurrentUser {
  return { id: 'u-1', email: 'analyst@example.invalid', fullName: 'Аналитик', role: 'ANALYST', universityId: null }
}

const NOW = new Date('2026-09-27T12:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('meetingsHeatmap: диапазон по умолчанию', () => {
  it('без from — ограничивает запрос последними 12 месяцами, а не всей историей', async () => {
    const result = await meetingsHeatmap(user(), {}, NOW)

    expect(repo.findHeldMeetings).toHaveBeenCalledTimes(1)
    const [, from, to] = repo.findHeldMeetings.mock.calls[0]!
    expect(from).toBeInstanceOf(Date)
    expect((from as Date).toISOString()).toBe('2025-09-27T12:00:00.000Z')
    expect((to as Date).toISOString()).toBe(NOW.toISOString())

    // Ответ честно называет применённую границу, а не «null — вся история».
    expect(result.from).toBe('2025-09-27T12:00:00.000Z')
    expect(result.to).toBe(NOW.toISOString())
  })

  it('явный from — используется как есть, без подмены умолчанием', async () => {
    const result = await meetingsHeatmap(user(), { from: '2026-01-01T00:00:00.000Z' }, NOW)

    const [, from] = repo.findHeldMeetings.mock.calls[0]!
    expect((from as Date).toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(result.from).toBe('2026-01-01T00:00:00.000Z')
  })

  it('from позже to — ошибка проверки, как и раньше (умолчание тут ни при чём)', async () => {
    await expect(
      meetingsHeatmap(user(), { from: '2026-09-28T00:00:00.000Z', to: '2026-09-27T00:00:00.000Z' }, NOW),
    ).rejects.toThrow()
    expect(repo.findHeldMeetings).not.toHaveBeenCalled()
  })
})
