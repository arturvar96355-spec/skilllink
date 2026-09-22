import { prisma } from '@/shared/db/prisma'
import { toSkipTake } from '@/shared/http/pagination'
import type { Prisma } from '@/generated/prisma/client'
import type { DataSourceListQuery } from './data-sources.schema'

const dataSourceSelect = {
  id: true,
  name: true,
  type: true,
  url: true,
  collectionDate: true,
  reliability: true,
  description: true,
  isMock: true,
  updatedAt: true,
  _count: { select: { demand: true } },
} satisfies Prisma.DataSourceSelect

export type DataSourceRow = Prisma.DataSourceGetPayload<{ select: typeof dataSourceSelect }>

export async function findMany(
  query: DataSourceListQuery,
): Promise<{ rows: DataSourceRow[]; total: number }> {
  const where: Prisma.DataSourceWhereInput = {}
  if (query.q) where.name = { contains: query.q, mode: 'insensitive' }

  const [rows, total] = await Promise.all([
    prisma.dataSource.findMany({
      where,
      select: dataSourceSelect,
      orderBy: { name: 'asc' },
      ...toSkipTake({ page: query.page, pageSize: query.pageSize }),
    }),
    prisma.dataSource.count({ where }),
  ])
  return { rows, total }
}

/** Источник опознаётся по имени: повторная синхронизация обновляет его, а не плодит копии. */
export async function upsertDataSource(data: {
  name: string
  type: 'MANUAL' | 'CSV' | 'EXTERNAL_API' | 'LMS' | 'SITE' | 'MOCK'
  reliability: 'LOW' | 'MEDIUM' | 'HIGH'
  isMock: boolean
  description: string
}): Promise<{ id: string }> {
  return prisma.dataSource.upsert({
    where: { name: data.name },
    create: { ...data, collectionDate: new Date() },
    update: { ...data, collectionDate: new Date() },
    select: { id: true },
  })
}

/** Справочник навыков по имени в нижнем регистре: источник может писать иначе. */
export async function loadSkillsByName(): Promise<Map<string, string>> {
  const skills = await prisma.skill.findMany({ select: { id: true, name: true } })
  return new Map(skills.map((skill) => [skill.name.toLowerCase(), skill.id]))
}

export interface DemandUpsert {
  skillId: string
  period: string
  value: number
  unit: string
  /**
   * Регион обязателен и входит в ключ уникальности: у одного навыка за период
   * от одного источника бывают замеры по разным регионам. Источник, не давший
   * региона, считается федеральным — «Россия».
   */
  region: string
  source: string
  dataSourceId: string
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  isMock: boolean
}

export async function upsertDemand(
  record: DemandUpsert,
): Promise<{ created: boolean }> {
  const existing = await prisma.marketDemand.findUnique({
    where: {
      // Регион — часть ключа: без него второй регион того же навыка
      // за тот же период не записывался вовсе (правка Тиграна).
      skillId_period_source_region: {
        skillId: record.skillId,
        period: record.period,
        source: record.source,
        region: record.region,
      },
    },
    select: { id: true },
  })

  if (existing) {
    await prisma.marketDemand.update({ where: { id: existing.id }, data: record })
    return { created: false }
  }

  await prisma.marketDemand.create({ data: record })
  return { created: true }
}
