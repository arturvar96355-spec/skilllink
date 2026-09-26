import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'

/**
 * Загрузка реестра из CSV (решение 190, находка ревью базы — N+1 при импорте):
 * `planUniversities`/`planPrograms` раньше запрашивали существующую запись на
 * каждую строку файла отдельно. Здесь база подменена репозиторием-фейком:
 * проверяется, что вузы и программы файла ищутся одним запросом на весь файл,
 * а не запросом на строку, и что построчный итог (создание/обновление/без
 * изменений/ошибка) не изменился.
 */

interface StoredUniversity {
  id: string
  name: string
  city: string
  region: string
  shortName: string | null
  website: string | null
  directionCount: number | null
  studentCount: number | null
  archivedAt: Date | null
}

interface StoredProgram {
  id: string
  universityId: string
  name: string
  level: string
  code: string | null
  direction: string | null
  durationMonths: number | null
  applicationCount: number | null
  studentCount: number | null
  groupCount: number | null
  archivedAt: Date | null
}

const store = vi.hoisted(() => ({
  universities: [] as StoredUniversity[],
  programs: [] as StoredProgram[],
}))

const repo = vi.hoisted(() => ({
  findUniversitiesByNames: vi.fn(async (names: string[]) => {
    const lower = new Set(names.map((name) => name.toLowerCase()))
    const map = new Map<string, StoredUniversity>()
    for (const university of store.universities) {
      if (lower.has(university.name.toLowerCase())) map.set(university.name.toLowerCase(), university)
    }
    return map
  }),
  findUniversityRefsByNames: vi.fn(async (names: string[]) => {
    const lower = new Set(names.map((name) => name.toLowerCase()))
    const map = new Map<string, { id: string; archivedAt: Date | null }>()
    for (const university of store.universities) {
      if (lower.has(university.name.toLowerCase())) {
        map.set(university.name.toLowerCase(), { id: university.id, archivedAt: university.archivedAt })
      }
    }
    return map
  }),
  findProgramsByNames: vi.fn(async (pairs: Array<{ universityId: string; name: string }>) => {
    const wanted = new Set(pairs.map((pair) => `${pair.universityId}::${pair.name.toLowerCase()}`))
    const map = new Map<string, StoredProgram>()
    for (const program of store.programs) {
      const key = `${program.universityId}::${program.name.toLowerCase()}`
      if (wanted.has(key)) map.set(key, program)
    }
    return map
  }),
  updateUniversity: vi.fn(async (id: string, data: Record<string, unknown>) => {
    const university = store.universities.find((item) => item.id === id)!
    Object.assign(university, data)
  }),
  createUniversity: vi.fn(async (data: Omit<StoredUniversity, 'id' | 'archivedAt'>) => {
    store.universities.push({ ...data, id: `u${store.universities.length + 1}`, archivedAt: null })
  }),
  updateProgram: vi.fn(async (id: string, data: Record<string, unknown>) => {
    const program = store.programs.find((item) => item.id === id)!
    Object.assign(program, data)
  }),
  createProgram: vi.fn(
    async (data: Omit<StoredProgram, 'id' | 'archivedAt'> & { universityId: string }) => {
      store.programs.push({ ...data, id: `p${store.programs.length + 1}`, archivedAt: null } as StoredProgram)
    },
  ),
}))

const audit = vi.hoisted(() => ({ writeAudit: vi.fn() }))

vi.mock('./import.repo', () => repo)
vi.mock('@/shared/audit/audit', () => audit)

const { importDataset } = await import('./import.service')

function user(): CurrentUser {
  return { id: 'u-manager', email: 'manager@example.invalid', fullName: 'Менеджер', role: 'MANAGER', universityId: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  store.universities = []
  store.programs = []
})

describe('importDataset — вузы', () => {
  it('одним запросом ищет существующие вузы файла, а не запросом на строку', async () => {
    store.universities.push({
      id: 'u1',
      name: 'МГУ',
      city: 'Москва',
      region: 'Москва',
      shortName: null,
      website: null,
      directionCount: null,
      studentCount: null,
      archivedAt: null,
    })
    const csv =
      'Название;Город;Регион\r\n' +
      'мгу;Москва;Московская область\r\n' + // тот же вуз без учёта регистра, регион изменился — обновление
      'СПбГУТ;Санкт-Петербург;Санкт-Петербург\r\n' // новый вуз — создание

    const result = await importDataset(user(), { dataset: 'universities', mode: 'apply' }, csv)

    // Один запрос на весь файл, а не два (по строке на каждую) — это и есть исправление N+1.
    expect(repo.findUniversitiesByNames).toHaveBeenCalledTimes(1)
    expect(repo.findUniversitiesByNames).toHaveBeenCalledWith(['мгу', 'СПбГУТ'])

    expect(result.created).toBe(1)
    expect(result.updated).toBe(1)
    expect(result.errors).toBe(0)
    expect(repo.updateUniversity).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ city: 'Москва', region: 'Московская область' }),
    )
    expect(repo.createUniversity).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'СПбГУТ', isMock: false }),
    )
  })

  it('вуз без изменений — «unchanged», без запросов на запись', async () => {
    store.universities.push({
      id: 'u1',
      name: 'МГУ',
      city: 'Москва',
      region: 'Москва',
      shortName: null,
      website: null,
      directionCount: null,
      studentCount: null,
      archivedAt: null,
    })
    const csv = 'Название;Город;Регион\r\nМГУ;Москва;Москва\r\n'
    const result = await importDataset(user(), { dataset: 'universities', mode: 'apply' }, csv)
    expect(result.unchanged).toBe(1)
    expect(repo.updateUniversity).not.toHaveBeenCalled()
    expect(repo.createUniversity).not.toHaveBeenCalled()
  })
})

describe('importDataset — программы', () => {
  it('одним запросом ищет вузы и одним — программы файла, а не запросом на строку', async () => {
    store.universities.push({
      id: 'u1',
      name: 'МГУ',
      city: 'Москва',
      region: 'Москва',
      shortName: null,
      website: null,
      directionCount: null,
      studentCount: null,
      archivedAt: null,
    })
    store.programs.push({
      id: 'p1',
      universityId: 'u1',
      name: 'Информатика',
      level: 'BACHELOR',
      code: null,
      direction: null,
      durationMonths: null,
      applicationCount: null,
      studentCount: null,
      groupCount: null,
      archivedAt: null,
    })
    const csv =
      'Вуз;Программа;Уровень\r\n' +
      'МГУ;информатика;Бакалавриат\r\n' + // та же программа без учёта регистра — обновление (нет изменений полей)
      'МГУ;Философия;Бакалавриат\r\n' // новая программа — создание

    const result = await importDataset(user(), { dataset: 'programs', mode: 'apply' }, csv)

    expect(repo.findUniversityRefsByNames).toHaveBeenCalledTimes(1)
    expect(repo.findProgramsByNames).toHaveBeenCalledTimes(1)

    expect(result.created).toBe(1)
    expect(result.unchanged).toBe(1)
    expect(result.errors).toBe(0)
    expect(repo.createProgram).toHaveBeenCalledWith(
      expect.objectContaining({ universityId: 'u1', name: 'Философия' }),
    )
  })

  it('вуз не найден в файле — построчная ошибка, без создания двойника', async () => {
    const csv = 'Вуз;Программа;Уровень\r\nНеизвестный вуз;Информатика;Бакалавриат\r\n'
    const result = await importDataset(user(), { dataset: 'programs', mode: 'apply' }, csv)
    expect(result.errors).toBe(1)
    expect(result.created).toBe(0)
    expect(repo.createProgram).not.toHaveBeenCalled()
  })
})
