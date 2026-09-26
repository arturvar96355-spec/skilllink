import { prisma } from '@/shared/db/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { addDays } from '@/shared/utils/date'

const templateSelect = {
  id: true,
  stageNumber: true,
  title: true,
  phase: true,
  normativeDays: true,
  isControlPoint: true,
  defaultTasks: true,
  updatedAt: true,
  updatedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.WorkflowStageTemplateSelect

export type WorkflowStageTemplateRow = Prisma.WorkflowStageTemplateGetPayload<{
  select: typeof templateSelect
}>

export async function findAll(): Promise<WorkflowStageTemplateRow[]> {
  return prisma.workflowStageTemplate.findMany({
    orderBy: { stageNumber: 'asc' },
    select: templateSelect,
  })
}

export async function findByNumber(stageNumber: number): Promise<WorkflowStageTemplateRow | null> {
  return prisma.workflowStageTemplate.findUnique({
    where: { stageNumber },
    select: templateSelect,
  })
}

export async function update(
  stageNumber: number,
  data: { title?: string; normativeDays?: number; updatedById: string },
): Promise<WorkflowStageTemplateRow> {
  return prisma.workflowStageTemplate.update({
    where: { stageNumber },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.normativeDays !== undefined ? { normativeDays: data.normativeDays } : {}),
      updatedById: data.updatedById,
    },
    select: templateSelect,
  })
}

/**
 * Значения по номеру этапа для НОВЫХ связок (cooperation.rules.ts, buildStages).
 * Пустая карта (таблица ещё не заполнена сидом на свежей базе) — вызывающий
 * код подставляет запасное значение из shared/config/workflow.config.ts.
 */
export async function loadDefaultsByNumber(): Promise<
  Map<number, { title: string; normativeDays: number }>
> {
  const rows = await prisma.workflowStageTemplate.findMany({
    select: { stageNumber: true, title: true, normativeDays: true },
  })
  return new Map(rows.map((row) => [row.stageNumber, { title: row.title, normativeDays: row.normativeDays }]))
}

/**
 * Применяет новые название/срок к незавершённым этапам уже заведённых связок
 * (опция `applyToUnfinishedStages` — ТЗ, п. 4: «существующие не меняются» по
 * умолчанию, но админ может явно распространить правку). Срок считается заново
 * от даты старта КАЖДОЙ связки, а не общей датой — иначе у связок разного
 * возраста дедлайн сдвинулся бы одинаково, а не по своим нормативным дням.
 *
 * Завершённые и отменённые этапы не трогаются: у них исторический факт, а не план.
 * Возвращает число изменённых этапов — для ответа API и журнала.
 */
export async function applyToUnfinishedStages(
  stageNumber: number,
  changes: { title?: string; normativeDays?: number },
): Promise<number> {
  if (changes.title === undefined && changes.normativeDays === undefined) return 0

  const stages = await prisma.workflowStage.findMany({
    where: { stageNumber, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
    select: { id: true, cooperation: { select: { startedAt: true, createdAt: true } } },
  })
  if (stages.length === 0) return 0

  await prisma.$transaction(
    stages.map((stage) =>
      prisma.workflowStage.update({
        where: { id: stage.id },
        data: {
          ...(changes.title !== undefined ? { title: changes.title } : {}),
          ...(changes.normativeDays !== undefined
            ? { deadline: addDays(stage.cooperation.startedAt ?? stage.cooperation.createdAt, changes.normativeDays) }
            : {}),
        },
      }),
    ),
  )
  return stages.length
}
