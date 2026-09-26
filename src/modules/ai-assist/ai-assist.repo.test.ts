import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `findRedactionContext` (решение 190, ревью базы): раньше при каждом вызове
 * читал ВСЕХ сотрудников и ВСЕ вузы целиком — а вызывается он для каждого
 * письма и каждого текста, который уходит в ИИ. Фильтр по universityIds
 * касается только контактных лиц, поэтому сотрудники и вузы вынесены в общий
 * кеш на минуту без ключа по области видимости: она здесь одна на всё
 * приложение. Сама выдача (кто в staff, кто в contacts, что в universityNames)
 * не изменилась.
 */
const db = vi.hoisted(() => ({
  user: { findMany: vi.fn() },
  university: { findMany: vi.fn() },
  contact: { findMany: vi.fn() },
}))

vi.mock('@/shared/db/prisma', () => ({ prisma: db }))

const repo = await import('./ai-assist.repo')

beforeEach(() => {
  vi.clearAllMocks()
  db.user.findMany.mockResolvedValue([
    { fullName: 'Сотрудник Иванов', role: 'MANAGER' },
    { fullName: 'Представитель Петров', role: 'UNIVERSITY_REP' },
  ])
  db.university.findMany.mockResolvedValue([{ name: 'Университет', shortName: 'УНИ' }])
  db.contact.findMany.mockResolvedValue([{ fullName: 'Контакт Сидоров' }])
})

const HOUR_MS = 60 * 60 * 1000
const baseAt = (hoursFromEpochStart: number) => new Date(Date.UTC(2026, 0, 1) + hoursFromEpochStart * HOUR_MS)

describe('findRedactionContext: сотрудники и вузы — из кеша на минуту', () => {
  it('два вызова подряд в пределах минуты — сотрудники и вузы читаются один раз', async () => {
    const now = baseAt(1)
    await repo.findRedactionContext(['univ-1'], now)
    await repo.findRedactionContext(['univ-1'], new Date(now.getTime() + 30_000))

    expect(db.user.findMany).toHaveBeenCalledTimes(1)
    expect(db.university.findMany).toHaveBeenCalledTimes(1)
    // Контакты по-прежнему запрашиваются на каждый вызов — они зависят от universityIds.
    expect(db.contact.findMany).toHaveBeenCalledTimes(2)
  })

  it('за пределами минуты — сотрудники и вузы читаются заново', async () => {
    const now = baseAt(2)
    await repo.findRedactionContext(['univ-1'], now)
    await repo.findRedactionContext(['univ-1'], new Date(now.getTime() + 60_001))

    expect(db.user.findMany).toHaveBeenCalledTimes(2)
    expect(db.university.findMany).toHaveBeenCalledTimes(2)
  })

  it('состав ответа не изменился: сотрудники в staff, представители и контакты — в contacts', async () => {
    const result = await repo.findRedactionContext(['univ-1'], baseAt(3))
    expect(result.people.staff).toEqual(['Сотрудник Иванов'])
    expect(result.people.contacts).toEqual(['Представитель Петров', 'Контакт Сидоров'])
    expect(result.universityNames).toEqual(['Университет', 'УНИ'])
  })

  it('без вузов в фильтре — contact.findMany не вызывается', async () => {
    await repo.findRedactionContext([], baseAt(4))
    expect(db.contact.findMany).not.toHaveBeenCalled()
  })
})
