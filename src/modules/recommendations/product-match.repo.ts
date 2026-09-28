import { prisma } from '@/shared/db/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { ACTIVE_PROGRAM_WHERE } from '@/modules/programs/programs.rules'
import type { MatchCooperation, MatchProduct, MatchProgram } from './product-match.rules'

/**
 * Данные для рекомендаций продуктов (решение 223). Всё читается целиком: в системе
 * десятки программ и продуктов, расчёт на лету — единицы миллисекунд, как у похожих
 * программ (решение 134).
 */

const programSelect = {
  id: true,
  name: true,
  code: true,
  universityId: true,
  university: { select: { name: true } },
  skills: { select: { skillId: true, level: true, skill: { select: { category: true } } } },
} satisfies Prisma.EducationalProgramSelect

type ProgramRow = Prisma.EducationalProgramGetPayload<{ select: typeof programSelect }>

function toMatchProgram(row: ProgramRow): MatchProgram {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    universityId: row.universityId,
    universityName: row.university.name,
    skills: row.skills.map((skill) => ({ skillId: skill.skillId, level: skill.level, category: skill.skill.category })),
  }
}

/** Действующие программы — для профилей направлений и общего списка; `where` сужает выборку. */
export async function findActivePrograms(where: Prisma.EducationalProgramWhereInput = {}): Promise<MatchProgram[]> {
  const rows = await prisma.educationalProgram.findMany({
    where: { ...ACTIVE_PROGRAM_WHERE, ...where },
    select: programSelect,
    orderBy: { name: 'asc' },
  })
  return rows.map(toMatchProgram)
}

/** Одна программа — даже в архиве: её карточка открывается и там. null — нет такой. */
export async function findProgram(id: string): Promise<MatchProgram | null> {
  const row = await prisma.educationalProgram.findUnique({ where: { id }, select: programSelect })
  return row ? toMatchProgram(row) : null
}

export async function findUniversity(id: string): Promise<{ id: string; name: string } | null> {
  return prisma.university.findUnique({ where: { id }, select: { id: true, name: true } })
}

/**
 * Продукты, которые можно предложить, — действующие. Планируемый вузу ещё не передать,
 * выводимый из обращения — уже незачем.
 */
export async function findActiveProducts(): Promise<MatchProduct[]> {
  const rows = await prisma.iTProduct.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      name: true,
      category: true,
      skills: {
        select: { skillId: true, relevance: true, skill: { select: { name: true, category: true } } },
        orderBy: { skill: { name: 'asc' } },
      },
    },
    orderBy: { name: 'asc' },
  })
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    skills: row.skills.map((skill) => ({
      skillId: skill.skillId,
      name: skill.skill.name,
      category: skill.skill.category,
      relevance: skill.relevance,
    })),
  }))
}

/** Связки с продуктом: что уже подключено, что отменено и с кем у вуза идёт работа. */
export async function findCooperations(where: Prisma.CooperationWhereInput = {}): Promise<MatchCooperation[]> {
  const rows = await prisma.cooperation.findMany({
    where,
    select: {
      programId: true,
      universityId: true,
      productId: true,
      status: true,
      closedAt: true,
      updatedAt: true,
      program: { select: { name: true } },
      product: { select: { name: true } },
    },
    orderBy: { updatedAt: 'desc' },
  })
  return rows.map((row) => ({
    programId: row.programId,
    programName: row.program.name,
    universityId: row.universityId,
    productId: row.productId,
    productName: row.product?.name ?? null,
    status: row.status,
    closedAt: row.closedAt,
    updatedAt: row.updatedAt,
  }))
}

/**
 * Кому письмо: основной контакт вуза, без него — самый ранний. Только ФИО и
 * должность — для маски на экране; в модель ничего из этого не уходит.
 */
export async function findPrimaryContact(
  universityId: string,
): Promise<{ fullName: string; position: string | null } | null> {
  return prisma.contact.findFirst({
    where: { universityId },
    select: { fullName: true, position: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  })
}
