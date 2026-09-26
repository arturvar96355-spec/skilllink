import { prisma } from '@/shared/db/prisma'
import type { Prisma } from '@/generated/prisma/client'

/** Больше строк одним отчётом не отдаём — тот же смысл предела, что у `/api/export` (limit). */
export const REPORT_ROW_LIMIT = 5000

function scopeWhere(scope: { universityId?: string }): Prisma.CooperationWhereInput {
  return scope.universityId ? { universityId: scope.universityId } : {}
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
export async function findTzRows(scope: { universityId?: string }): Promise<TzReportRow[]> {
  return prisma.cooperation.findMany({
    where: scopeWhere(scope),
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
export async function findCatalogRows(scope: { universityId?: string }): Promise<CatalogReportRow[]> {
  return prisma.cooperation.findMany({
    where: scopeWhere(scope),
    select: catalogSelect,
    orderBy: [{ university: { name: 'asc' } }, { createdAt: 'asc' }],
    take: REPORT_ROW_LIMIT,
  })
}
