import { prisma } from '@/shared/db/prisma'
import { toSkipTake } from '@/shared/http/pagination'
import type { Prisma } from '@/generated/prisma/client'
import { MATERIALS_STAGE_NUMBER } from './portal.rules'
import type { ApplicationListQuery } from './portal.schema'

export async function findUniversity(id: string) {
  return prisma.university.findUnique({
    where: { id },
    select: { id: true, name: true, archivedAt: true },
  })
}

export async function findPrograms(universityId: string) {
  return prisma.educationalProgram.findMany({
    where: { universityId, archivedAt: null },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      level: true,
      applicationCount: true,
      studentCount: true,
      groupCount: true,
      metricsUpdatedAt: true,
    },
  })
}

export async function findCooperations(universityId: string) {
  return prisma.cooperation.findMany({
    where: { universityId },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      status: true,
      classesStartAt: true,
      program: { select: { name: true } },
      product: { select: { name: true } },
      stages: {
        orderBy: { stageNumber: 'asc' },
        select: { stageNumber: true, title: true, status: true, deadline: true },
      },
    },
  })
}

/** Задачи этапа передачи материалов по всем связкам вуза. */
export async function findMaterials(universityId: string) {
  return prisma.task.findMany({
    where: {
      stage: {
        stageNumber: MATERIALS_STAGE_NUMBER,
        cooperation: { universityId },
      },
    },
    orderBy: [{ stage: { cooperationId: 'asc' } }, { sortOrder: 'asc' }],
    select: {
      id: true,
      title: true,
      isDone: true,
      doneAt: true,
      stage: {
        select: {
          status: true,
          cooperationId: true,
          cooperation: {
            select: {
              program: { select: { name: true } },
              product: { select: { name: true } },
            },
          },
        },
      },
    },
  })
}

export async function findMaterialTask(taskId: string, universityId: string) {
  return prisma.task.findFirst({
    where: { id: taskId, stage: { cooperation: { universityId } } },
    select: {
      id: true,
      isDone: true,
      stage: { select: { id: true, stageNumber: true, cooperationId: true } },
    },
  })
}

export async function confirmMaterial(taskId: string, userId: string): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: { isDone: true, doneAt: new Date(), doneById: userId },
  })
}

export async function countDocuments(universityId: string): Promise<number> {
  return prisma.document.count({
    where: {
      OR: [{ universityId }, { cooperation: { universityId } }, { program: { universityId } }],
    },
  })
}

export async function findProgram(programId: string, universityId: string) {
  return prisma.educationalProgram.findFirst({
    where: { id: programId, universityId, archivedAt: null },
    select: { id: true, universityId: true, metricsSource: true },
  })
}

export async function updateProgramMetrics(
  programId: string,
  data: { studentCount?: number | null; groupCount?: number | null },
): Promise<void> {
  await prisma.educationalProgram.update({
    where: { id: programId },
    data: {
      ...data,
      // Источник — сам вуз: это фактические данные, а не оценка.
      metricsSource: 'MANUAL',
      metricsUpdatedAt: new Date(),
    },
  })
}

export async function createApplication(
  data: Prisma.ApplicationCreateInput,
): Promise<{ id: string }> {
  return prisma.application.create({ data, select: { id: true } })
}

/**
 * Пересчитывает applicationCount программы по сумме заявок (решение 9).
 * Отменённые и отклонённые заявки не учитываются.
 */
export async function recalcApplicationCount(programId: string): Promise<number> {
  const aggregate = await prisma.application.aggregate({
    where: { programId, status: { in: ['NEW', 'CONFIRMED', 'ENROLLED'] } },
    _sum: { quantity: true },
  })
  const total = aggregate._sum.quantity ?? 0

  await prisma.educationalProgram.update({
    where: { id: programId },
    data: { applicationCount: total, metricsSource: 'MANUAL', metricsUpdatedAt: new Date() },
  })
  return total
}

export async function findApplications(universityId: string, query: ApplicationListQuery) {
  const where: Prisma.ApplicationWhereInput = { universityId }
  if (query.programId) where.programId = query.programId
  if (query.status) where.status = query.status

  const [rows, total] = await Promise.all([
    prisma.application.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      select: {
        id: true,
        programId: true,
        universityId: true,
        status: true,
        source: true,
        quantity: true,
        comment: true,
        submittedAt: true,
        createdAt: true,
        program: { select: { name: true } },
      },
      ...toSkipTake({ page: query.page, pageSize: query.pageSize }),
    }),
    prisma.application.count({ where }),
  ])
  return { rows, total }
}
