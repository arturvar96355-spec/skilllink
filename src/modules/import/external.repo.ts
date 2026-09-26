import { prisma } from '@/shared/db/prisma'
import type { Prisma } from '@/generated/prisma/client'
import type { ExternalImportSource } from './external.schema'

/** Плейсхолдер для полей, которых нет в примерном контракте ТЗ (город, регион, категория). */
export const EXTERNAL_IMPORT_PLACEHOLDER = 'Не указано (данные извне)'

export async function findLink(source: ExternalImportSource, externalId: string) {
  return prisma.externalImportLink.findUnique({
    where: { source_externalId: { source, externalId } },
    select: { id: true, cooperationId: true },
  })
}

export async function createLink(
  source: ExternalImportSource,
  externalId: string,
  cooperationId: string,
): Promise<void> {
  await prisma.externalImportLink.create({ data: { source, externalId, cooperationId } })
}

export async function findUniversityByInn(inn: string) {
  return prisma.university.findFirst({ where: { inn }, select: { id: true, archivedAt: true } })
}

export async function findUniversityByName(name: string) {
  return prisma.university.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { id: true, archivedAt: true },
  })
}

export async function createUniversity(input: {
  name: string
  inn: string | null
  city: string | null
  region: string | null
}) {
  return prisma.university.create({
    data: {
      name: input.name,
      inn: input.inn,
      city: input.city ?? EXTERNAL_IMPORT_PLACEHOLDER,
      region: input.region ?? EXTERNAL_IMPORT_PLACEHOLDER,
      status: 'NEW',
    },
    select: { id: true },
  })
}

export async function findProgramByCode(universityId: string, code: string) {
  return prisma.educationalProgram.findFirst({
    where: { universityId, code, archivedAt: null },
    select: { id: true },
  })
}

export async function findProgramByName(universityId: string, name: string) {
  return prisma.educationalProgram.findFirst({
    where: { universityId, name: { equals: name, mode: 'insensitive' }, archivedAt: null },
    select: { id: true },
  })
}

/** Уровень по умолчанию для программы, заведённой извне: контракт его не передаёт. */
const EXTERNAL_IMPORT_DEFAULT_LEVEL: Prisma.EducationalProgramCreateInput['level'] = 'DPO'

export async function createProgram(input: { universityId: string; name: string; code: string | null }) {
  return prisma.educationalProgram.create({
    data: {
      university: { connect: { id: input.universityId } },
      name: input.name,
      code: input.code,
      level: EXTERNAL_IMPORT_DEFAULT_LEVEL,
      status: 'ACTIVE',
    },
    select: { id: true },
  })
}

export async function findProductByName(name: string) {
  return prisma.iTProduct.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
  })
}

export async function createProduct(name: string) {
  return prisma.iTProduct.create({
    data: { name, category: EXTERNAL_IMPORT_PLACEHOLDER, status: 'ACTIVE' },
    select: { id: true },
  })
}

/** Первый действующий сотрудник (ADMIN/MANAGER), чья почта — среди присланных, по порядку списка. */
export async function findResponsibleByEmails(emails: readonly string[]) {
  const candidates = await prisma.user.findMany({
    where: { email: { in: [...emails] }, isActive: true, role: { in: ['ADMIN', 'MANAGER'] } },
    select: { id: true, email: true },
  })
  const byEmail = new Map(candidates.map((row) => [row.email.toLowerCase(), row]))
  for (const email of emails) {
    const found = byEmail.get(email)
    if (found) return found
  }
  return null
}

export async function findCooperationRef(id: string) {
  return prisma.cooperation.findUnique({
    where: { id },
    select: { id: true, universityId: true, programId: true, productId: true, responsibleId: true, status: true },
  })
}

export async function updateCooperationLink(
  id: string,
  data: { productId: string | null; responsibleId: string },
): Promise<void> {
  await prisma.cooperation.update({
    where: { id },
    data: {
      responsible: { connect: { id: data.responsibleId } },
      ...(data.productId ? { product: { connect: { id: data.productId } } } : {}),
    },
  })
}
