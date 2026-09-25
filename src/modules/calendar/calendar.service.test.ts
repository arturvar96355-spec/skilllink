import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { UserRole } from '@/shared/contracts/enums'
import { hashFeedToken } from './calendar.rules'

/**
 * Подписка на календарь: кому можно, что уходит в базу и журнал, чью ленту
 * отдаёт токен. База и журнал подменены — проверяются запросы, а не данные.
 */
const mocks = vi.hoisted(() => ({
  calendarFeed: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
  workflowStage: { findMany: vi.fn() },
  meeting: { findMany: vi.fn() },
  writeAudit: vi.fn(),
}))

vi.mock('@/shared/db/prisma', () => {
  const client = {
    calendarFeed: mocks.calendarFeed,
    workflowStage: mocks.workflowStage,
    meeting: mocks.meeting,
  }
  return { prisma: { ...client, $transaction: (fn: (tx: typeof client) => unknown) => fn(client) } }
})

vi.mock('@/shared/audit/audit', () => ({ writeAudit: mocks.writeAudit }))

const service = await import('./calendar.service')

const as = (role: UserRole, id = 'me'): CurrentUser => ({
  id,
  email: `${id}@skilllink.demo`,
  fullName: 'Текущий Пользователь',
  role,
  universityId: role === 'UNIVERSITY_REP' ? 'uni-1' : null,
})

const owner = (overrides: Partial<{ id: string; role: UserRole; isActive: boolean }> = {}) => ({
  user: { id: 'me', email: 'me@skilllink.demo', fullName: 'Владелец', role: 'MANAGER', universityId: null, isActive: true, ...overrides },
})

const TOKEN = 'A'.repeat(43)
const NOW = new Date('2026-09-25T09:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.calendarFeed.upsert.mockResolvedValue({ createdAt: NOW })
  mocks.workflowStage.findMany.mockResolvedValue([])
  mocks.meeting.findMany.mockResolvedValue([])
})

describe('права на подписку', () => {
  it('представитель вуза получает 403 на статус, выпуск и отзыв', async () => {
    const rep = as('UNIVERSITY_REP')
    for (const action of [service.status, service.issue, service.revoke]) {
      await expect(action(rep)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    expect(mocks.calendarFeed.upsert).not.toHaveBeenCalled()
    expect(mocks.calendarFeed.deleteMany).not.toHaveBeenCalled()
  })

  it.each(['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER'] as UserRole[])('%s может выпустить ссылку', async (role) => {
    mocks.calendarFeed.findUnique.mockResolvedValue(null)
    await expect(service.issue(as(role))).resolves.toMatchObject({ replaced: false })
  })
})

describe('выпуск, перевыпуск и отзыв', () => {
  it('в базу — только хеш токена из выданной ссылки; ссылка — один раз, в ответе', async () => {
    mocks.calendarFeed.findUnique.mockResolvedValue(null)
    const issued = await service.issue(as('MANAGER'))

    const token = /\/api\/calendar\/([A-Za-z0-9_-]{43})\.ics$/.exec(issued.url)?.[1]
    expect(token).toBeDefined()
    expect(issued.webcalUrl.startsWith('webcal://')).toBe(true)

    const saved = mocks.calendarFeed.upsert.mock.calls[0]![0]
    expect(saved.where).toEqual({ userId: 'me' })
    expect(saved.create.tokenHash).toBe(hashFeedToken(token!))
    expect(saved.update.tokenHash).toBe(hashFeedToken(token!))
    expect(JSON.stringify(saved)).not.toContain(token!)
  })

  it('перевыпуск заменяет хеш той же строки — новая ссылка не совпадает со старой', async () => {
    mocks.calendarFeed.findUnique.mockResolvedValue(null)
    const first = await service.issue(as('MANAGER'))
    mocks.calendarFeed.findUnique.mockResolvedValue({ userId: 'me' })
    const second = await service.issue(as('MANAGER'))

    expect(second.url).not.toBe(first.url)
    expect(second.replaced).toBe(true)
    const [one, two] = mocks.calendarFeed.upsert.mock.calls.map((call) => call[0].update.tokenHash)
    expect(two).not.toBe(one)
  })

  it('журнал: calendar.issue и calendar.revoke без токена и хеша', async () => {
    mocks.calendarFeed.findUnique.mockResolvedValue(null)
    const issued = await service.issue(as('MANAGER'))
    mocks.calendarFeed.deleteMany.mockResolvedValue({ count: 1 })
    await expect(service.revoke(as('MANAGER'))).resolves.toEqual({ revoked: true })

    expect(mocks.writeAudit.mock.calls.map((call) => call[0].action)).toEqual(['calendar.issue', 'calendar.revoke'])
    const logged = JSON.stringify(mocks.writeAudit.mock.calls)
    const token = issued.url.split('/').pop()!.replace('.ics', '')
    expect(logged).not.toContain(token)
    expect(logged).not.toContain(hashFeedToken(token))
  })

  it('отзыв удаляет только свою подписку; повторный — revoked=false и без записи в журнал', async () => {
    mocks.calendarFeed.deleteMany.mockResolvedValue({ count: 0 })
    await expect(service.revoke(as('VIEWER', 'viewer-1'))).resolves.toEqual({ revoked: false })
    expect(mocks.calendarFeed.deleteMany).toHaveBeenCalledWith({ where: { userId: 'viewer-1' } })
    expect(mocks.writeAudit).not.toHaveBeenCalled()
  })

  it('статус не содержит адреса', async () => {
    mocks.calendarFeed.findUnique.mockResolvedValue({ createdAt: NOW })
    const status = await service.status(as('ANALYST'))
    expect(status).toEqual({ active: true, createdAt: NOW.toISOString() })
  })
})

describe('лента по токену', () => {
  it('ищет владельца по хешу токена, а не по токену', async () => {
    mocks.calendarFeed.findUnique.mockResolvedValue(owner())
    await service.renderFeed(`${TOKEN}.ics`, NOW)
    expect(mocks.calendarFeed.findUnique.mock.calls[0]![0].where).toEqual({ tokenHash: hashFeedToken(TOKEN) })
  })

  it('кривое имя файла — 404 без запроса к базе', async () => {
    await expect(service.renderFeed('не-токен.ics', NOW)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(mocks.calendarFeed.findUnique).not.toHaveBeenCalled()
  })

  it('неизвестный токен, заблокированный владелец и представитель вуза — одинаковый 404', async () => {
    const cases = [null, owner({ isActive: false }), owner({ role: 'UNIVERSITY_REP' })]
    const messages: string[] = []
    for (const found of cases) {
      mocks.calendarFeed.findUnique.mockResolvedValueOnce(found)
      const error = await service.renderFeed(`${TOKEN}.ics`, NOW).catch((caught: unknown) => caught)
      expect(error).toMatchObject({ code: 'NOT_FOUND' })
      messages.push((error as Error).message)
    }
    expect(new Set(messages).size).toBe(1)
    expect(mocks.workflowStage.findMany).not.toHaveBeenCalled()
  })

  it('выборка — только этапы и встречи владельца ссылки', async () => {
    mocks.calendarFeed.findUnique.mockResolvedValue(owner({ id: 'owner-7' }))
    await service.renderFeed(`${TOKEN}.ics`, NOW)

    for (const [query] of mocks.workflowStage.findMany.mock.calls) {
      expect(query.where.OR).toEqual([{ responsibleId: 'owner-7' }, { cooperation: { responsibleId: 'owner-7' } }])
      expect(query.where.status).toEqual({ notIn: ['COMPLETED', 'CANCELLED'] })
      expect(query.take).toBeLessThanOrEqual(500)
    }
    for (const [query] of mocks.meeting.findMany.mock.calls) {
      expect(query.where.OR).toEqual([
        { responsibleId: 'owner-7' },
        { participants: { some: { userId: 'owner-7' } } },
      ])
      // Участники не выбираются вовсе — ФИО и почт контактов в ленте быть не может.
      expect(query.select.participants).toBeUndefined()
      expect(query.take).toBeLessThanOrEqual(500)
    }
    expect(mocks.workflowStage.findMany).toHaveBeenCalledTimes(2)
    expect(mocks.meeting.findMany).toHaveBeenCalledTimes(2)
  })

  it('собирает календарь из выбранного', async () => {
    mocks.calendarFeed.findUnique.mockResolvedValue(owner())
    mocks.workflowStage.findMany.mockResolvedValueOnce([
      {
        id: 'st-1',
        stageNumber: 3,
        title: 'Анализ программы',
        status: 'IN_PROGRESS',
        deadline: new Date('2026-09-20T09:00:00Z'),
        cooperationId: 'coop-1',
        cooperation: { university: { name: 'Университет', shortName: 'СПбГУТ' }, program: { name: 'ПИ' } },
      },
    ])
    mocks.meeting.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'm-1',
        date: new Date('2026-09-28T11:30:00Z'),
        topic: 'Созвон',
        format: 'CALL',
        cooperationId: null,
        universityId: 'u-1',
        programId: null,
        university: { name: 'Университет', shortName: null },
        program: null,
        cooperation: null,
      },
    ])

    const text = (await service.renderFeed(`${TOKEN}.ics`, NOW)).replace(/\r\n[ \t]/g, '')
    expect(text).toContain('SUMMARY:[Просрочен] Срок: этап 3 «Анализ программы» — СПбГУТ\\, ПИ')
    expect(text).toContain('UID:meeting-m-1@skilllink')
    expect(text).toContain('Вуз: Университет')
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2)
  })
})
