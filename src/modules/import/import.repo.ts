import { prisma } from '@/shared/db/prisma'
import type { Prisma } from '@/generated/prisma/client'

/**
 * Вуз опознаётся по названию: другого устойчивого ключа в файле у человека нет.
 * Поля — те, что можно поменять файлом: по ним видно, изменится ли что-нибудь.
 */
export async function findUniversityByName(name: string) {
  return prisma.university.findFirst({
    where: { name },
    select: {
      id: true,
      city: true,
      region: true,
      shortName: true,
      website: true,
      directionCount: true,
      studentCount: true,
      archivedAt: true,
    },
  })
}

/** Вуз, к которому привязывается программа из файла. */
export async function findUniversityRefByName(name: string) {
  return prisma.university.findFirst({
    where: { name },
    select: { id: true, archivedAt: true },
  })
}

export async function updateUniversity(id: string, data: Prisma.UniversityUpdateInput): Promise<void> {
  await prisma.university.update({ where: { id }, data })
}

export async function createUniversity(data: Prisma.UniversityCreateInput): Promise<void> {
  await prisma.university.create({ data })
}

/** Программа опознаётся по вузу и названию. */
export async function findProgramByName(universityId: string, name: string) {
  return prisma.educationalProgram.findFirst({
    where: { universityId, name },
    select: {
      id: true,
      level: true,
      code: true,
      direction: true,
      durationMonths: true,
      applicationCount: true,
      studentCount: true,
      groupCount: true,
      archivedAt: true,
    },
  })
}

export async function updateProgram(id: string, data: Prisma.EducationalProgramUpdateInput): Promise<void> {
  await prisma.educationalProgram.update({ where: { id }, data })
}

export async function createProgram(data: Prisma.EducationalProgramUncheckedCreateInput): Promise<void> {
  await prisma.educationalProgram.create({ data })
}
