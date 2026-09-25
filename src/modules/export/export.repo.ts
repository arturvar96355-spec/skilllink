import { prisma } from '@/shared/db/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { listOrderBy } from '@/modules/cooperation/cooperation.repo'
import type { CooperationListQuery } from '@/modules/cooperation/cooperation.schema'

/** Поля вуза, которых нет в строке реестра: численность, сайт и основной контакт. */
export async function findUniversityExtras(ids: string[]) {
  return prisma.university.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      directionCount: true,
      studentCount: true,
      website: true,
      contacts: {
        where: { isPrimary: true },
        take: 1,
        select: { fullName: true, position: true, email: true },
      },
    },
  })
}

/**
 * Связки для файла: условие строит реестр связок (buildWhere), порядок — тоже его,
 * поэтому в файл попадает то, что отобрано на экране.
 */
export async function findCooperations(
  where: Prisma.CooperationWhereInput,
  query: Pick<CooperationListQuery, 'sort'>,
  limit: number,
) {
  return prisma.cooperation.findMany({
    where,
    orderBy: listOrderBy(query),
    take: limit,
    select: {
      status: true,
      goal: true,
      classesStartAt: true,
      targetDate: true,
      isMock: true,
      updatedAt: true,
      university: { select: { name: true } },
      program: { select: { name: true } },
      product: { select: { name: true } },
      responsible: { select: { fullName: true } },
      stages: {
        orderBy: { stageNumber: 'asc' },
        select: { stageNumber: true, title: true, status: true, deadline: true },
      },
    },
  })
}
