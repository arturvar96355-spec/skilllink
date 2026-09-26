import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'

/**
 * Отметка «прочитано» на сервере (решение 139).
 *
 * `feed` — правила расчёта самой ленты уже проверены в notifications.test.ts
 * (`buildFeed`); здесь важно другое: откуда берётся граница «прочитано» —
 * серверное значение, необязательный `since` от клиента, и как они сочетаются.
 * `markSeen` — что записывается в базу и что отклоняется.
 *
 * База подменена: сервис не должен сам решать бизнес-правила по данным из репозитория,
 * поэтому источники ленты в этих тестах пустые везде, где это не мешает проверке.
 */
const repo = vi.hoisted(() => ({
  loadForStaff: vi.fn(),
  loadForUniversity: vi.fn(),
  getSeenAt: vi.fn(),
  setSeenAt: vi.fn(),
}))

vi.mock('./notifications.repo', () => repo)

const service = await import('./notifications.service')

const NOW = new Date('2026-09-26T12:00:00.000Z')

function manager(): CurrentUser {
  return {
    id: 'user-1',
    email: 'manager@skilllink.demo',
    fullName: 'Тестовый Менеджер',
    role: 'MANAGER',
    universityId: null,
  }
}

const EMPTY_SOURCES = { deadlines: [], stageChanges: [], documentChanges: [], recommendations: [] }

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  repo.loadForStaff.mockResolvedValue(EMPTY_SOURCES)
  repo.getSeenAt.mockResolvedValue(null)
})

afterEach(() => vi.useRealTimers())

describe('лента: откуда берётся граница «прочитано»', () => {
  it('без серверной отметки и без since от клиента — непрочитанным считается всё', async () => {
    const deadline = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000)
    repo.loadForStaff.mockResolvedValue({
      ...EMPTY_SOURCES,
      deadlines: [
        {
          stageId: 's-1',
          stageNumber: 6,
          stageTitle: 'Подписание документов',
          status: 'IN_PROGRESS',
          deadline,
          cooperationId: 'coop-1',
          universityName: 'СПбГУТ',
          programName: 'Программная инженерия',
          lockedByControlPoint: false,
        },
      ],
    })
    const result = await service.feed(manager(), { limit: 20 })
    expect(result.unreadCount).toBe(1)
  })

  it('серверная отметка новее события — событие прочитано без since от клиента', async () => {
    const deadline = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000)
    repo.loadForStaff.mockResolvedValue({
      ...EMPTY_SOURCES,
      deadlines: [
        {
          stageId: 's-1',
          stageNumber: 6,
          stageTitle: 'Подписание документов',
          status: 'IN_PROGRESS',
          deadline,
          cooperationId: 'coop-1',
          universityName: 'СПбГУТ',
          programName: 'Программная инженерия',
          lockedByControlPoint: false,
        },
      ],
    })
    repo.getSeenAt.mockResolvedValue(new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000))
    const result = await service.feed(manager(), { limit: 20 })
    expect(result.unreadCount).toBe(0)
  })

  it('since от клиента старше серверной отметки — не «протухает» ленту назад', async () => {
    // Старый фронт всё ещё шлёт since из localStorage. Он не должен снова показать
    // прочитанным непрочитанное на сервере.
    const deadline = new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000)
    repo.loadForStaff.mockResolvedValue({
      ...EMPTY_SOURCES,
      deadlines: [
        {
          stageId: 's-1',
          stageNumber: 6,
          stageTitle: 'Подписание документов',
          status: 'IN_PROGRESS',
          deadline,
          cooperationId: 'coop-1',
          universityName: 'СПбГУТ',
          programName: 'Программная инженерия',
          lockedByControlPoint: false,
        },
      ],
    })
    // Сервер ещё не видел ленту вовсе.
    repo.getSeenAt.mockResolvedValue(null)
    const oldClientSince = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString()
    const result = await service.feed(manager(), { limit: 20, since: oldClientSince })
    expect(result.unreadCount).toBe(1)
  })

  it('since от клиента новее серверной отметки — используется он (более позднее из двух)', async () => {
    const deadline = new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000)
    repo.loadForStaff.mockResolvedValue({
      ...EMPTY_SOURCES,
      deadlines: [
        {
          stageId: 's-1',
          stageNumber: 6,
          stageTitle: 'Подписание документов',
          status: 'IN_PROGRESS',
          deadline,
          cooperationId: 'coop-1',
          universityName: 'СПбГУТ',
          programName: 'Программная инженерия',
          lockedByControlPoint: false,
        },
      ],
    })
    repo.getSeenAt.mockResolvedValue(new Date(NOW.getTime() - 20 * 24 * 60 * 60 * 1000))
    const freshClientSince = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString()
    const result = await service.feed(manager(), { limit: 20, since: freshClientSince })
    expect(result.unreadCount).toBe(0)
  })
})

describe('отметка «прочитано»: POST /api/notifications/seen', () => {
  it('без seenAt ставит текущее время сервера', async () => {
    const result = await service.markSeen(manager(), {})
    expect(result.seenAt).toBe(NOW.toISOString())
    expect(repo.setSeenAt).toHaveBeenCalledWith('user-1', NOW)
  })

  it('с seenAt в прошлом — ставит переданное время', async () => {
    const past = new Date(NOW.getTime() - 60 * 60 * 1000)
    const result = await service.markSeen(manager(), { seenAt: past.toISOString() })
    expect(result.seenAt).toBe(past.toISOString())
    expect(repo.setSeenAt).toHaveBeenCalledWith('user-1', past)
  })

  it('с seenAt в будущем — отклоняется, в базу ничего не пишется', async () => {
    const future = new Date(NOW.getTime() + 60 * 60 * 1000)
    await expect(service.markSeen(manager(), { seenAt: future.toISOString() })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
    expect(repo.setSeenAt).not.toHaveBeenCalled()
  })
})
