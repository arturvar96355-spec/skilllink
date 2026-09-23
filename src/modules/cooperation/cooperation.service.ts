import { prisma } from '@/shared/db/prisma'
import { notFound, validationError } from '@/shared/http/errors'
import { pageMeta } from '@/shared/http/pagination'
import { assertCan, canSeeInternalNotes, universityScope } from '@/shared/auth/permissions'
import { writeAudit } from '@/shared/audit/audit'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { PageMeta } from '@/shared/contracts/common'
import type {
  CooperationDto,
  CooperationListItemDto,
  CooperationProgressDto,
  CurrentStageDto,
} from '@/shared/contracts/cooperation'
import { daysToDeadline, toIso, toIsoRequired } from '@/shared/utils/date'
import {
  computeProgressPercent,
  findCurrentStage,
  isAutoManaged,
  isDueSoon,
  isOverdue,
} from '@/modules/workflow/workflow.rules'
import { toStageDto } from '@/modules/workflow/workflow.service'
import * as workflowRepo from '@/modules/workflow/workflow.repo'
import * as repo from './cooperation.repo'
import {
  assertCooperationEditable,
  assertProgramBelongsToUniversity,
  buildStages,
  isClosedStatus,
} from './cooperation.rules'
import type {
  CooperationListQuery,
  CreateCooperationInput,
  UpdateCooperationInput,
} from './cooperation.schema'

type StageSummary = repo.CooperationListRow['stages'][number]

function toCurrentStage(stages: StageSummary[], now: Date): CurrentStageDto | null {
  const current = findCurrentStage(stages)
  if (!current) return null
  return {
    id: current.id,
    stageNumber: current.stageNumber,
    title: current.title,
    phase: current.phase,
    status: current.status,
    deadline: toIso(current.deadline),
    isOverdue: isOverdue(current.deadline, current.status, now),
    isDueSoon: isDueSoon(current.deadline, current.status, now),
    daysToDeadline: daysToDeadline(current.deadline, now),
  }
}

function toProgress(stages: StageSummary[], now: Date): CooperationProgressDto {
  // Контрольный этап 14 в процент не входит: он лишь отражает состояние остальных.
  const countable = stages.filter((stage) => !isAutoManaged(stage.stageNumber))
  return {
    percent: computeProgressPercent(countable.map((stage) => stage.status)),
    completedStages: countable.filter((stage) => stage.status === 'COMPLETED').length,
    cancelledStages: countable.filter((stage) => stage.status === 'CANCELLED').length,
    totalStages: countable.length,
    overdueStages: countable.filter((stage) => isOverdue(stage.deadline, stage.status, now)).length,
    dueSoonStages: countable.filter((stage) => isDueSoon(stage.deadline, stage.status, now)).length,
    blockedStages: countable.filter((stage) => stage.status === 'BLOCKED').length,
  }
}

function toListItem(row: repo.CooperationListRow, now: Date): CooperationListItemDto {
  const target = row.targetDate ?? row.classesStartAt
  return {
    id: row.id,
    universityId: row.universityId,
    universityName: row.university.name,
    universityShortName: row.university.shortName,
    programId: row.programId,
    programName: row.program.name,
    productId: row.productId,
    productName: row.product?.name ?? null,
    status: row.status,
    responsible: row.responsible,
    currentStage: toCurrentStage(row.stages, now),
    progress: toProgress(row.stages, now),
    targetDate: toIso(row.targetDate),
    classesStartAt: toIso(row.classesStartAt),
    daysToTarget: daysToDeadline(target, now),
    isMock: row.isMock,
    updatedAt: toIsoRequired(row.updatedAt),
  }
}

export async function list(
  user: CurrentUser,
  query: CooperationListQuery,
): Promise<{ data: CooperationListItemDto[]; meta: PageMeta }> {
  assertCan(user, 'READ')
  const now = new Date()
  const { rows, total } = await repo.findMany(query, universityScope(user), now)
  return {
    data: rows.map((row) => toListItem(row, now)),
    meta: pageMeta({ page: query.page, pageSize: query.pageSize }, total),
  }
}

export async function getById(user: CurrentUser, id: string): Promise<CooperationDto> {
  assertCan(user, 'READ')
  const row = await repo.findById(id, universityScope(user))
  if (!row) throw notFound('Связка не найдена')

  const now = new Date()
  const stages = await workflowRepo.findStagesByCooperation(id)
  const hideInternalNotes = !canSeeInternalNotes(user)

  return {
    ...toListItem(row, now),
    goal: row.goal,
    // Заметки по связке — внутренние: вуз их не видит (решение 9).
    notes: hideInternalNotes ? null : row.notes,
    firstContactAt: toIso(row.firstContactAt),
    startedAt: toIso(row.startedAt),
    closedAt: toIso(row.closedAt),
    createdAt: toIsoRequired(row.createdAt),
    stages: stages.map((stage) => toStageDto(stage, now, { hideInternalNotes })),
  }
}

/** Создание связки: сразу появляются все 14 этапов с чек-листами и нормативными сроками. */
export async function create(
  user: CurrentUser,
  input: CreateCooperationInput,
): Promise<CooperationDto> {
  assertCan(user, 'WRITE')

  const [university, program, responsible, product] = await Promise.all([
    prisma.university.findUnique({
      where: { id: input.universityId },
      select: { id: true, archivedAt: true },
    }),
    prisma.educationalProgram.findUnique({
      where: { id: input.programId },
      select: { id: true, universityId: true, archivedAt: true },
    }),
    prisma.user.findFirst({
      where: { id: input.responsibleId, isActive: true },
      select: { id: true },
    }),
    input.productId
      ? prisma.iTProduct.findUnique({ where: { id: input.productId }, select: { id: true } })
      : Promise.resolve(null),
  ])

  if (!university) {
    throw validationError('Указан несуществующий вуз', [
      { field: 'universityId', message: 'Вуз не найден' },
    ])
  }
  // Вуз в архиве проверяется наравне с программой. Иначе ломается обещание
  // архива: архивировать вуз с открытыми связками нельзя, но сразу после
  // архивации новую связку можно было завести — и «в архиве нет открытой
  // работы» переставало быть правдой.
  if (university.archivedAt) {
    throw validationError('Вуз в архиве', [
      { field: 'universityId', message: 'Восстановите вуз из архива, чтобы заводить связки' },
    ])
  }

  if (!program) {
    throw validationError('Указана несуществующая программа', [
      { field: 'programId', message: 'Программа не найдена' },
    ])
  }
  if (program.archivedAt) {
    throw validationError('Программа в архиве', [
      { field: 'programId', message: 'Выберите действующую программу' },
    ])
  }
  assertProgramBelongsToUniversity(program.universityId, input.universityId)

  if (!responsible) {
    throw validationError('Указан несуществующий ответственный', [
      { field: 'responsibleId', message: 'Сотрудник не найден' },
    ])
  }
  if (input.productId && !product) {
    throw validationError('Указан несуществующий IT-продукт', [
      { field: 'productId', message: 'Продукт не найден' },
    ])
  }

  const startedAt = new Date()
  const id = await repo.createWithStages(
    {
      university: { connect: { id: input.universityId } },
      program: { connect: { id: input.programId } },
      ...(input.productId ? { product: { connect: { id: input.productId } } } : {}),
      responsible: { connect: { id: input.responsibleId } },
      status: input.status,
      goal: input.goal ?? null,
      notes: input.notes ?? null,
      firstContactAt: input.firstContactAt ? new Date(input.firstContactAt) : null,
      classesStartAt: input.classesStartAt ? new Date(input.classesStartAt) : null,
      targetDate: input.targetDate ? new Date(input.targetDate) : null,
      startedAt,
    },
    buildStages(startedAt, input.responsibleId),
  )

  await writeAudit({
    userId: user.id,
    action: 'cooperation.create',
    objectType: 'Cooperation',
    objectId: id,
    payload: { universityId: input.universityId, programId: input.programId },
  })

  return getById(user, id)
}

export async function update(
  user: CurrentUser,
  id: string,
  input: UpdateCooperationInput,
): Promise<CooperationDto> {
  assertCan(user, 'WRITE')

  const existing = await repo.findById(id, universityScope(user))
  if (!existing) throw notFound('Связка не найдена')
  assertCooperationEditable(existing.status, input.status)

  if (input.responsibleId) {
    const responsible = await prisma.user.findFirst({
      where: { id: input.responsibleId, isActive: true },
      select: { id: true },
    })
    if (!responsible) {
      throw validationError('Указан несуществующий ответственный', [
        { field: 'responsibleId', message: 'Сотрудник не найден' },
      ])
    }
  }

  const wasClosed = isClosedStatus(existing.status)
  const closing = input.status !== undefined && isClosedStatus(input.status) && !wasClosed
  // Переоткрытие снимает дату закрытия: иначе действующая связка носит дату,
  // когда её якобы закрыли.
  const reopening = input.status !== undefined && !isClosedStatus(input.status) && wasClosed

  await repo.update(id, {
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.responsibleId
      ? { responsible: { connect: { id: input.responsibleId } } }
      : {}),
    ...(input.productId !== undefined
      ? input.productId
        ? { product: { connect: { id: input.productId } } }
        : { product: { disconnect: true } }
      : {}),
    ...(input.goal !== undefined ? { goal: input.goal } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.firstContactAt !== undefined
      ? { firstContactAt: input.firstContactAt ? new Date(input.firstContactAt) : null }
      : {}),
    ...(input.classesStartAt !== undefined
      ? { classesStartAt: input.classesStartAt ? new Date(input.classesStartAt) : null }
      : {}),
    ...(input.targetDate !== undefined
      ? { targetDate: input.targetDate ? new Date(input.targetDate) : null }
      : {}),
    ...(closing ? { closedAt: new Date() } : {}),
    ...(reopening ? { closedAt: null } : {}),
  })

  await writeAudit({
    userId: user.id,
    action: 'cooperation.update',
    objectType: 'Cooperation',
    objectId: id,
    payload: { fields: Object.keys(input) },
  })

  return getById(user, id)
}
