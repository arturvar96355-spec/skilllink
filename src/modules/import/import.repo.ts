import { prisma } from '@/shared/db/prisma'
import type { Prisma } from '@/generated/prisma/client'

const universityByNameSelect = {
  id: true,
  name: true,
  city: true,
  region: true,
  shortName: true,
  website: true,
  directionCount: true,
  studentCount: true,
  archivedAt: true,
} satisfies Prisma.UniversitySelect

const universityRefSelect = { id: true, name: true, archivedAt: true } satisfies Prisma.UniversitySelect

const programByNameSelect = {
  id: true,
  universityId: true,
  name: true,
  level: true,
  code: true,
  direction: true,
  durationMonths: true,
  applicationCount: true,
  studentCount: true,
  groupCount: true,
  archivedAt: true,
} satisfies Prisma.EducationalProgramSelect

export type UniversityByNameRow = Prisma.UniversityGetPayload<{ select: typeof universityByNameSelect }>
export type UniversityRefRow = Prisma.UniversityGetPayload<{ select: typeof universityRefSelect }>
export type ProgramByNameRow = Prisma.EducationalProgramGetPayload<{ select: typeof programByNameSelect }>

/**
 * Вузы по названиям одним запросом — вместо запроса на каждую строку файла
 * (решение 190, находка ревью «N+1 в импорте»). Ключ карты — название в нижнем
 * регистре: сравнение без учёта регистра, как раньше у `findUniversityByName`,
 * иначе «МГУ» и «мгу» из разных файлов завели бы два вуза-дубля вместо обновления
 * одного.
 */
export async function findUniversitiesByNames(names: readonly string[]): Promise<Map<string, UniversityByNameRow>> {
  if (names.length === 0) return new Map()
  const rows = await prisma.university.findMany({
    where: { name: { in: [...new Set(names)], mode: 'insensitive' } },
    select: universityByNameSelect,
  })
  return new Map(rows.map((row) => [row.name.toLowerCase(), row]))
}

/** Вузы-ссылки (для привязки программы), по названиям — тем же пакетным запросом. */
export async function findUniversityRefsByNames(names: readonly string[]): Promise<Map<string, UniversityRefRow>> {
  if (names.length === 0) return new Map()
  const rows = await prisma.university.findMany({
    where: { name: { in: [...new Set(names)], mode: 'insensitive' } },
    select: universityRefSelect,
  })
  return new Map(rows.map((row) => [row.name.toLowerCase(), row]))
}

export async function updateUniversity(id: string, data: Prisma.UniversityUpdateInput): Promise<void> {
  await prisma.university.update({ where: { id }, data })
}

export async function createUniversity(data: Prisma.UniversityCreateInput): Promise<void> {
  await prisma.university.create({ data })
}

/**
 * Существующие программы по паре (вуз, название) одним запросом — вместо запроса
 * на каждую строку файла. Ключ карты — `${universityId}::${название в нижнем регистре}`:
 * то же сравнение без учёта регистра, что раньше делал `findProgramByName`.
 *
 * Запрос берёт «названия из файла у любого из перечисленных вузов» — шире точного
 * набора пар, но это один пакетный запрос вместо запроса на строку, а лишние строки
 * просто не находят себе пары в карте.
 */
export async function findProgramsByNames(
  pairs: readonly { universityId: string; name: string }[],
): Promise<Map<string, ProgramByNameRow>> {
  if (pairs.length === 0) return new Map()
  const universityIds = [...new Set(pairs.map((pair) => pair.universityId))]
  const names = [...new Set(pairs.map((pair) => pair.name))]
  const rows = await prisma.educationalProgram.findMany({
    where: { universityId: { in: universityIds }, name: { in: names, mode: 'insensitive' } },
    select: programByNameSelect,
  })
  return new Map(rows.map((row) => [`${row.universityId}::${row.name.toLowerCase()}`, row]))
}

export async function updateProgram(id: string, data: Prisma.EducationalProgramUpdateInput): Promise<void> {
  await prisma.educationalProgram.update({ where: { id }, data })
}

export async function createProgram(data: Prisma.EducationalProgramUncheckedCreateInput): Promise<void> {
  await prisma.educationalProgram.create({ data })
}
