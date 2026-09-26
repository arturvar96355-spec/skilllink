import { prisma } from '@/shared/db/prisma'
import { Prisma } from '@/generated/prisma/client'
import type { DuplicateEntityType } from '@/shared/contracts/data-quality'
import type {
  ProductCandidate,
  ProgramCandidate,
  SkillCandidate,
  UniversityCandidate,
} from './duplicates.rules'

/**
 * Доступ к базе для качества данных (решение 134): записи для сравнения,
 * кандидаты по pg_trgm, исключения «не дубль», сводка для отчёта.
 */

/** Вузы для сравнения. Слитые в другой — никогда; архивные — по запросу. */
export async function loadUniversities(includeArchived: boolean): Promise<UniversityCandidate[]> {
  return prisma.university.findMany({
    where: { mergedIntoId: null, ...(includeArchived ? {} : { archivedAt: null }) },
    select: { id: true, name: true, shortName: true, city: true, inn: true },
  })
}

export async function loadSkills(): Promise<SkillCandidate[]> {
  return prisma.skill.findMany({ select: { id: true, name: true, category: true } })
}

export async function loadPrograms(includeArchived: boolean): Promise<ProgramCandidate[]> {
  const rows = await prisma.educationalProgram.findMany({
    where: includeArchived ? {} : { archivedAt: null },
    select: {
      id: true,
      name: true,
      code: true,
      level: true,
      universityId: true,
      university: { select: { name: true } },
    },
  })
  return rows.map(({ university, ...row }) => ({ ...row, universityName: university.name }))
}

export async function loadProducts(): Promise<ProductCandidate[]> {
  return prisma.iTProduct.findMany({ select: { id: true, name: true, category: true } })
}

/** Установлено ли расширение pg_trgm: без него кандидатов отбирает только приложение. */
export async function hasTrigramExtension(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ ok: number }>>`
    SELECT 1 AS ok FROM pg_extension WHERE extname = 'pg_trgm'`
  return rows.length > 0
}

/**
 * Кандидаты в дубли, отобранные базой: пары, у которых `name % name` — сходство
 * по триграммам не ниже порога. Оператор `%` использует GIN-индекс `…_name_trgm`.
 * Порог задаётся на транзакцию (`set_config(…, true)`), чужие запросы он не задевает.
 *
 * Имена таблиц — из фиксированного списка, не из запроса.
 */
const TRIGRAM_SQL: Record<DuplicateEntityType, (includeArchived: boolean) => Prisma.Sql> = {
  university: (includeArchived) => Prisma.sql`
    SELECT a.id AS "first", b.id AS "second" FROM universities a
      JOIN universities b ON a.id < b.id AND a.name % b.name
     WHERE a.merged_into_id IS NULL AND b.merged_into_id IS NULL
       ${includeArchived ? Prisma.empty : Prisma.sql`AND a.archived_at IS NULL AND b.archived_at IS NULL`}`,
  skill: () => Prisma.sql`
    SELECT a.id AS "first", b.id AS "second" FROM skills a
      JOIN skills b ON a.id < b.id AND a.name % b.name`,
  program: (includeArchived) => Prisma.sql`
    SELECT a.id AS "first", b.id AS "second" FROM educational_programs a
      JOIN educational_programs b ON a.id < b.id AND a.university_id = b.university_id AND a.name % b.name
     WHERE TRUE ${includeArchived ? Prisma.empty : Prisma.sql`AND a.archived_at IS NULL AND b.archived_at IS NULL`}`,
  product: () => Prisma.sql`
    SELECT a.id AS "first", b.id AS "second" FROM it_products a
      JOIN it_products b ON a.id < b.id AND a.name % b.name`,
}

export async function trigramCandidatePairs(
  entity: DuplicateEntityType,
  threshold: number,
  includeArchived: boolean,
): Promise<Array<[string, string]>> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('pg_trgm.similarity_threshold', ${String(threshold)}, true)`
    const rows = await tx.$queryRaw<Array<{ first: string; second: string }>>(TRIGRAM_SQL[entity](includeArchived))
    return rows.map((row) => [row.first, row.second] as [string, string])
  })
}

// ────────────────────────────────── Исключения ────────────────────────────────

export async function findDismissedKeys(entity: DuplicateEntityType): Promise<Set<string>> {
  const rows = await prisma.duplicateDismissal.findMany({
    where: { entity },
    select: { firstId: true, secondId: true },
  })
  return new Set(rows.map((row) => `${row.firstId}|${row.secondId}`))
}

const userRefSelect = { id: true, fullName: true, role: true } satisfies Prisma.UserSelect

const dismissalSelect = {
  id: true,
  entity: true,
  firstId: true,
  secondId: true,
  comment: true,
  createdAt: true,
  dismissedBy: { select: userRefSelect },
} satisfies Prisma.DuplicateDismissalSelect

export type DismissalRow = Prisma.DuplicateDismissalGetPayload<{ select: typeof dismissalSelect }>

/** Существуют ли обе записи пары: отметить «не дубль» несуществующее нельзя. */
export async function countExisting(entity: DuplicateEntityType, ids: readonly string[]): Promise<number> {
  const where = { id: { in: [...ids] } }
  switch (entity) {
    case 'university':
      return prisma.university.count({ where })
    case 'skill':
      return prisma.skill.count({ where })
    case 'program':
      return prisma.educationalProgram.count({ where })
    case 'product':
      return prisma.iTProduct.count({ where })
  }
}

/**
 * Отметить пару «не дубль». Повтор — не ошибка: возвращается уже сохранённая
 * отметка (`created: false`), журнал второй раз не пишется.
 */
export async function upsertDismissal(input: {
  entity: DuplicateEntityType
  firstId: string
  secondId: string
  comment: string | null
  userId: string
}): Promise<{ row: DismissalRow; created: boolean }> {
  const key = { entity: input.entity, firstId: input.firstId, secondId: input.secondId }
  const existing = await prisma.duplicateDismissal.findUnique({
    where: { entity_firstId_secondId: key },
    select: dismissalSelect,
  })
  if (existing) return { row: existing, created: false }
  try {
    const row = await prisma.duplicateDismissal.create({
      data: { ...key, comment: input.comment, dismissedById: input.userId },
      select: dismissalSelect,
    })
    return { row, created: true }
  } catch (error) {
    // Два одновременных «не дубль» на одну пару: второй упирается в уникальность.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const row = await prisma.duplicateDismissal.findUniqueOrThrow({
        where: { entity_firstId_secondId: key },
        select: dismissalSelect,
      })
      return { row, created: false }
    }
    throw error
  }
}

// ───────────────────────────────── Отчёт качества ─────────────────────────────

/** Всё, из чего складывается отчёт: по одному запросу на сущность. */
export async function loadReportInput(now: Date) {
  const [universities, programs, skills, products, cooperations] = await Promise.all([
    prisma.university.findMany({
      where: { archivedAt: null },
      select: {
        id: true,
        name: true,
        isMock: true,
        contacts: { select: { fullName: true, email: true, phone: true, position: true } },
        programs: { where: { archivedAt: null }, select: { id: true } },
      },
    }),
    prisma.educationalProgram.findMany({
      where: { archivedAt: null },
      select: {
        id: true,
        name: true,
        isMock: true,
        updatedAt: true,
        metricsUpdatedAt: true,
        skills: { select: { updatedAt: true } },
      },
    }),
    prisma.skill.findMany({
      select: {
        id: true,
        name: true,
        _count: { select: { programs: { where: { program: { archivedAt: null } } }, demand: true, products: true } },
      },
    }),
    prisma.iTProduct.findMany({
      select: { id: true, name: true, isMock: true, _count: { select: { skills: true } } },
    }),
    prisma.cooperation.findMany({
      where: { status: { in: ['DRAFT', 'ACTIVE', 'PAUSED'] } },
      select: {
        id: true,
        isMock: true,
        createdAt: true,
        university: { select: { name: true } },
        program: { select: { name: true } },
        responsible: { select: { isActive: true } },
        meetings: { where: { date: { lte: now } }, orderBy: { date: 'desc' }, take: 1, select: { date: true } },
      },
    }),
  ])
  return { universities, programs, skills, products, cooperations }
}

export type ReportInput = Awaited<ReturnType<typeof loadReportInput>>
