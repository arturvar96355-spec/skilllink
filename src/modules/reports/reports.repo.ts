import { prisma } from '@/shared/db/prisma'
import { intersectUniversityFilter } from '@/shared/auth/scope'
import type { Prisma } from '@/generated/prisma/client'
import type { ReportFilters } from './reports.schema'

/** Больше строк одним отчётом не отдаём — тот же смысл предела, что у `/api/export` (limit). */
export const REPORT_ROW_LIMIT = 5000

/**
 * Условие выборки связок для обоих отчётов (решение 172): фильтры по вузу,
 * программе, продукту, ответственному, статусу и периоду активности.
 *
 * `null` — представитель вуза запросил чужой вуз: выборка заведомо пуста,
 * существование чужой записи не раскрывается (то же правило, что у реестра
 * связок, `cooperation.repo.ts`).
 */
export function buildReportWhere(
  filters: ReportFilters,
  scope: { universityId?: string },
): Prisma.CooperationWhereInput | null {
  const universityFilter = intersectUniversityFilter(scope, filters.universityId)
  if (universityFilter === null) return null

  const where: Prisma.CooperationWhereInput = { ...universityFilter }
  if (filters.programId) where.programId = filters.programId
  if (filters.productId) where.productId = filters.productId
  if (filters.responsibleId) where.responsibleId = filters.responsibleId
  if (filters.status) where.status = filters.status

  /**
   * Период — связки, действующие в периоде (см. `reports.schema.ts`): созданные
   * не позже его конца и не закрытые до его начала.
   */
  const and: Prisma.CooperationWhereInput[] = []
  if (filters.dateTo) and.push({ createdAt: { lte: new Date(filters.dateTo) } })
  if (filters.dateFrom) {
    and.push({ OR: [{ closedAt: null }, { closedAt: { gte: new Date(filters.dateFrom) } }] })
  }
  if (and.length > 0) where.AND = and

  return where
}

const tzSelect = {
  university: { select: { name: true } },
  program: { select: { name: true } },
  product: { select: { name: true } },
  status: true,
  responsible: { select: { fullName: true } },
} satisfies Prisma.CooperationSelect

export type TzReportRow = Prisma.CooperationGetPayload<{ select: typeof tzSelect }>

/** Строки отчёта «по ТЗ» (п.7) — вуз, ИТ-направление, ИТ-продукт, статус, ответственный. */
export async function findTzRows(
  filters: ReportFilters,
  scope: { universityId?: string },
): Promise<TzReportRow[]> {
  const where = buildReportWhere(filters, scope)
  if (where === null) return []
  return prisma.cooperation.findMany({
    where,
    select: tzSelect,
    orderBy: [{ university: { name: 'asc' } }, { program: { name: 'asc' } }],
    take: REPORT_ROW_LIMIT,
  })
}

const catalogSelect = {
  university: {
    select: {
      name: true,
      contacts: {
        select: { fullName: true },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        take: 5,
      },
    },
  },
  product: { select: { name: true, vendor: { select: { name: true } } } },
  contractNumber: true,
  licenseSignedAt: true,
  licenseTermYears: true,
  transferStatus: true,
  comment: true,
  responsible: { select: { fullName: true } },
} satisfies Prisma.CooperationSelect

export type CatalogReportRow = Prisma.CooperationGetPayload<{ select: typeof catalogSelect }>

/** Строки «Каталога по ТЗ» (п.8). */
export async function findCatalogRows(
  filters: ReportFilters,
  scope: { universityId?: string },
): Promise<CatalogReportRow[]> {
  const where = buildReportWhere(filters, scope)
  if (where === null) return []
  return prisma.cooperation.findMany({
    where,
    select: catalogSelect,
    orderBy: [{ university: { name: 'asc' } }, { createdAt: 'asc' }],
    take: REPORT_ROW_LIMIT,
  })
}

/** Имена фильтров — для строки-заголовка файла (решение 172). */
export interface ReportFilterLabels {
  universityName?: string
  programName?: string
  productName?: string
  responsibleName?: string
}

/**
 * Резолвит id фильтров в читаемые имена для шапки файла: строки отчёта их не
 * несут, когда фильтр не даёт ни одной строки (например, пустой период).
 *
 * Вуз вне области видимости представителя не резолвится — то же правило,
 * что у самого фильтра: наличие чужой записи не раскрывается.
 */
export async function resolveFilterLabels(
  filters: ReportFilters,
  scope: { universityId?: string },
): Promise<ReportFilterLabels> {
  if (buildReportWhere(filters, scope) === null) return {}

  const [university, program, product, responsible] = await Promise.all([
    filters.universityId
      ? prisma.university.findUnique({ where: { id: filters.universityId }, select: { name: true } })
      : null,
    filters.programId
      ? prisma.educationalProgram.findUnique({ where: { id: filters.programId }, select: { name: true } })
      : null,
    filters.productId
      ? prisma.iTProduct.findUnique({ where: { id: filters.productId }, select: { name: true } })
      : null,
    filters.responsibleId
      ? prisma.user.findUnique({ where: { id: filters.responsibleId }, select: { fullName: true } })
      : null,
  ])

  return {
    universityName: university?.name,
    programName: program?.name,
    productName: product?.name,
    responsibleName: responsible?.fullName,
  }
}
