import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Репозиторий загрузки файла (импорта, решение 187, дополнено решением 190):
 * вуз и программа опознаются по названию без учёта регистра — как в external.repo.ts.
 * До исправления сравнение было чувствительно к регистру: «МГУ» из одного
 * файла и «мгу» из другого заводили бы два вуза-дубля вместо обновления
 * одного и того же.
 *
 * Решение 190: поиск — одним пакетным запросом по всем названиям файла, а не
 * запросом на каждую строку (находка ревью базы, N+1).
 */
const db = vi.hoisted(() => ({
  university: { findMany: vi.fn() },
  educationalProgram: { findMany: vi.fn() },
}))

vi.mock('@/shared/db/prisma', () => ({ prisma: db }))

const repo = await import('./import.repo')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('findUniversitiesByNames', () => {
  it('одним запросом ищет вузы без учёта регистра и кладёт их в карту по названию в нижнем регистре', async () => {
    db.university.findMany.mockResolvedValue([{ id: 'u1', name: 'МГУ', archivedAt: null }])
    const result = await repo.findUniversitiesByNames(['мгу', 'СПбГУ'])
    expect(db.university.findMany).toHaveBeenCalledTimes(1)
    expect(db.university.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: { in: ['мгу', 'СПбГУ'], mode: 'insensitive' } } }),
    )
    expect(result.get('мгу')).toEqual({ id: 'u1', name: 'МГУ', archivedAt: null })
  })

  it('без названий не обращается к базе', async () => {
    const result = await repo.findUniversitiesByNames([])
    expect(db.university.findMany).not.toHaveBeenCalled()
    expect(result.size).toBe(0)
  })
})

describe('findUniversityRefsByNames', () => {
  it('одним запросом ищет вузы-ссылки без учёта регистра', async () => {
    db.university.findMany.mockResolvedValue([{ id: 'u1', name: 'МГУ', archivedAt: null }])
    const result = await repo.findUniversityRefsByNames(['МГУ'])
    expect(db.university.findMany).toHaveBeenCalledTimes(1)
    expect(db.university.findMany).toHaveBeenCalledWith({
      where: { name: { in: ['МГУ'], mode: 'insensitive' } },
      select: { id: true, name: true, archivedAt: true },
    })
    expect(result.get('мгу')).toEqual({ id: 'u1', name: 'МГУ', archivedAt: null })
  })
})

describe('findProgramsByNames', () => {
  it('одним запросом ищет программы по вузам и названиям без учёта регистра', async () => {
    db.educationalProgram.findMany.mockResolvedValue([
      { id: 'p1', universityId: 'u1', name: 'Прикладная информатика', archivedAt: null },
    ])
    const result = await repo.findProgramsByNames([{ universityId: 'u1', name: 'прикладная информатика' }])
    expect(db.educationalProgram.findMany).toHaveBeenCalledTimes(1)
    expect(db.educationalProgram.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { universityId: { in: ['u1'] }, name: { in: ['прикладная информатика'], mode: 'insensitive' } },
      }),
    )
    expect(result.get('u1::прикладная информатика')).toEqual({
      id: 'p1',
      universityId: 'u1',
      name: 'Прикладная информатика',
      archivedAt: null,
    })
  })

  it('без пар не обращается к базе', async () => {
    const result = await repo.findProgramsByNames([])
    expect(db.educationalProgram.findMany).not.toHaveBeenCalled()
    expect(result.size).toBe(0)
  })
})
