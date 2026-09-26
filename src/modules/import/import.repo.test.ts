import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Репозиторий загрузки файла (импорта, решение 187): вуз и программа
 * опознаются по названию без учёта регистра — как в external.repo.ts.
 * До исправления сравнение было чувствительно к регистру: «МГУ» из одного
 * файла и «мгу» из другого заводили бы два вуза-дубля вместо обновления
 * одного и того же.
 */
const db = vi.hoisted(() => ({
  university: { findFirst: vi.fn() },
  educationalProgram: { findFirst: vi.fn() },
}))

vi.mock('@/shared/db/prisma', () => ({ prisma: db }))

const repo = await import('./import.repo')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('findUniversityByName', () => {
  it('ищет вуз без учёта регистра', async () => {
    db.university.findFirst.mockResolvedValue(null)
    await repo.findUniversityByName('мгу')
    expect(db.university.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: { equals: 'мгу', mode: 'insensitive' } } }),
    )
  })
})

describe('findUniversityRefByName', () => {
  it('ищет вуз без учёта регистра', async () => {
    db.university.findFirst.mockResolvedValue(null)
    await repo.findUniversityRefByName('МГУ')
    expect(db.university.findFirst).toHaveBeenCalledWith({
      where: { name: { equals: 'МГУ', mode: 'insensitive' } },
      select: { id: true, archivedAt: true },
    })
  })
})

describe('findProgramByName', () => {
  it('ищет программу по вузу и названию без учёта регистра', async () => {
    db.educationalProgram.findFirst.mockResolvedValue(null)
    await repo.findProgramByName('u1', 'Прикладная информатика')
    expect(db.educationalProgram.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { universityId: 'u1', name: { equals: 'Прикладная информатика', mode: 'insensitive' } },
      }),
    )
  })
})
