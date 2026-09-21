import { prisma } from '@/shared/db/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { conflict, notFound } from '@/shared/http/errors'
import { pageMeta } from '@/shared/http/pagination'
import {
  assertCan,
  canSeeInternalNotes,
  isUniversityVisible,
  universityScope,
} from '@/shared/auth/permissions'
import { writeAudit } from '@/shared/audit/audit'
import { CONTROL_STAGE_NUMBER } from '@/shared/config/workflow.config'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { PageMeta } from '@/shared/contracts/common'
import type { CooperationStatus, StageStatus } from '@/shared/contracts/enums'
import type {
  StageHistoryEntryDto,
  StageWithCooperationDto,
  WorkflowStageDto,
} from '@/shared/contracts/workflow'
import { daysToDeadline, toIso, toIsoRequired } from '@/shared/utils/date'
import * as repo from './workflow.repo'
import { assertCooperationOpen } from '@/modules/cooperation/cooperation.rules'
import {
  assertTasksEditable,
  assertTransition,
  computeControlStatus,
  isAutoManaged,
  isOverdue,
} from './workflow.rules'
import type { StageListQuery, UpdateStageInput, UpdateTaskInput } from './workflow.schema'

export interface StageDtoOptions {
  /** Скрыть внутренние комментарии сотрудников: для представителя вуза (решение 9). */
  hideInternalNotes?: boolean
}

export function toStageDto(
  row: repo.StageRow,
  now: Date = new Date(),
  options: StageDtoOptions = {},
): WorkflowStageDto {
  const requiredTasks = row.tasks.filter((task) => task.isRequired)
  const hide = options.hideInternalNotes === true
  return {
    id: row.id,
    cooperationId: row.cooperationId,
    stageNumber: row.stageNumber,
    title: row.title,
    phase: row.phase,
    status: row.status,
    responsible: row.responsible,
    deadline: toIso(row.deadline),
    isOverdue: isOverdue(row.deadline, row.status, now),
    daysToDeadline: daysToDeadline(row.deadline, now),
    // Результат этапа вуз видит: это итог работы. Комментарии и причины блокировок — нет.
    comment: hide ? null : row.comment,
    result: row.result,
    blockingReason: hide ? null : row.blockingReason,
    startedAt: toIso(row.startedAt),
    completedAt: toIso(row.completedAt),
    completedBy: row.completedBy,
    isAutoManaged: isAutoManaged(row.stageNumber),
    tasks: row.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      isRequired: task.isRequired,
      isDone: task.isDone,
      doneAt: toIso(task.doneAt),
      doneBy: task.doneBy,
      sortOrder: task.sortOrder,
    })),
    requiredTasksTotal: requiredTasks.length,
    requiredTasksDone: requiredTasks.filter((task) => task.isDone).length,
    updatedAt: toIsoRequired(row.updatedAt),
  }
}

function toStageWithCooperationDto(
  row: repo.StageWithCooperationRow,
  now: Date,
  options: StageDtoOptions = {},
): StageWithCooperationDto {
  return {
    ...toStageDto(row, now, options),
    universityName: row.cooperation.university.name,
    programName: row.cooperation.program.name,
    productName: row.cooperation.product?.name ?? null,
  }
}

/**
 * Проверяет, что связка видна пользователю (решение 10), и возвращает её статус.
 * Статус нужен изменяющим операциям: у закрытой связки процесс заморожен.
 */
async function loadVisibleCooperation(
  user: CurrentUser,
  cooperationId: string,
): Promise<{ status: CooperationStatus }> {
  const cooperation = await prisma.cooperation.findUnique({
    where: { id: cooperationId },
    select: { universityId: true, status: true },
  })
  if (!cooperation || !isUniversityVisible(user, cooperation.universityId)) {
    throw notFound('Связка не найдена')
  }
  return { status: cooperation.status }
}

async function assertCooperationVisible(user: CurrentUser, cooperationId: string): Promise<void> {
  await loadVisibleCooperation(user, cooperationId)
}

export async function listByCooperation(
  user: CurrentUser,
  cooperationId: string,
): Promise<WorkflowStageDto[]> {
  assertCan(user, 'READ')
  await assertCooperationVisible(user, cooperationId)
  const now = new Date()
  const rows = await repo.findStagesByCooperation(cooperationId)
  if (rows.length === 0) throw notFound('Этапы связки не найдены')
  const hideInternalNotes = !canSeeInternalNotes(user)
  return rows.map((row) => toStageDto(row, now, { hideInternalNotes }))
}

/**
 * Пересчёт контрольного этапа 14 по состоянию этапов 1–13 (решение 2).
 * Вызывается после любого изменения статуса обычного этапа.
 */
async function recomputeControlStage(
  tx: Prisma.TransactionClient,
  cooperationId: string,
  userId: string,
): Promise<void> {
  const stages = await tx.workflowStage.findMany({
    where: { cooperationId },
    select: { id: true, stageNumber: true, status: true },
  })

  const control = stages.find((stage) => stage.stageNumber === CONTROL_STAGE_NUMBER)
  if (!control) return

  const others = stages
    .filter((stage) => stage.stageNumber !== CONTROL_STAGE_NUMBER)
    .map((stage) => stage.status as StageStatus)

  const next = computeControlStatus(others)
  if (next === control.status) return

  await tx.workflowStage.update({
    where: { id: control.id },
    data: {
      status: next,
      // Контрольный этап закрывает система, а не человек: автора завершения у него нет.
      completedAt: next === 'COMPLETED' ? new Date() : null,
      completedById: null,
    },
  })

  await tx.stageHistory.create({
    data: {
      stageId: control.id,
      fromStatus: control.status,
      toStatus: next,
      comment: 'Пересчитано автоматически по состоянию этапов 1–13',
      changedById: userId,
    },
  })
}

export async function updateStage(
  user: CurrentUser,
  stageId: string,
  input: UpdateStageInput,
): Promise<WorkflowStageDto> {
  assertCan(user, 'WRITE')

  const stage = await repo.findStageById(stageId)
  if (!stage) throw notFound('Этап не найден')
  const cooperation = await loadVisibleCooperation(user, stage.cooperationId)
  assertCooperationOpen(cooperation.status)

  const requiredTasks = stage.tasks.filter((task) => task.isRequired)
  const statusChanged = input.status !== undefined && input.status !== stage.status

  if (input.status !== undefined) {
    assertTransition(
      {
        stageNumber: stage.stageNumber,
        status: stage.status,
        result: stage.result,
        requiredTasksTotal: requiredTasks.length,
        requiredTasksDone: requiredTasks.filter((task) => task.isDone).length,
      },
      {
        toStatus: input.status,
        comment: input.comment,
        result: input.result,
        blockingReason: input.blockingReason,
      },
      user.role,
    )
  } else if (isAutoManaged(stage.stageNumber)) {
    // Правки полей контрольного этапа тоже запрещены: он полностью вычисляемый.
    assertTransition(
      {
        stageNumber: stage.stageNumber,
        status: stage.status,
        result: stage.result,
        requiredTasksTotal: requiredTasks.length,
        requiredTasksDone: requiredTasks.filter((task) => task.isDone).length,
      },
      { toStatus: stage.status },
      user.role,
    )
  }

  const now = new Date()
  const next = input.status ?? stage.status

  await prisma.$transaction(async (tx) => {
    // Обновление условное: статус меняется, только если он всё ещё тот, который мы прочитали.
    // Иначе два одновременных запроса (двойной клик) оба прошли бы проверку перехода
    // и записали бы в историю два одинаковых события.
    const changed = await tx.workflowStage.updateMany({
      where: { id: stageId, status: stage.status },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.responsibleId !== undefined ? { responsibleId: input.responsibleId } : {}),
        ...(input.deadline !== undefined
          ? { deadline: input.deadline ? new Date(input.deadline) : null }
          : {}),
        ...(input.comment !== undefined ? { comment: input.comment } : {}),
        ...(input.result !== undefined ? { result: input.result } : {}),
        // Причина блокировки живёт только пока этап заблокирован.
        ...(next === 'BLOCKED'
          ? { blockingReason: input.blockingReason ?? stage.blockingReason }
          : statusChanged
            ? { blockingReason: null }
            : {}),
        ...(statusChanged && next === 'IN_PROGRESS' && !stage.startedAt
          ? { startedAt: now }
          : {}),
        ...(statusChanged && next === 'COMPLETED'
          ? { completedAt: now, completedById: user.id }
          : {}),
        ...(statusChanged && stage.status === 'COMPLETED' && next !== 'COMPLETED'
          ? { completedAt: null, completedById: null }
          : {}),
      },
    })

    if (changed.count === 0) {
      throw conflict(
        'Этап уже изменён другим пользователем. Обновите страницу и повторите действие.',
        { expectedStatus: stage.status },
      )
    }

    if (statusChanged) {
      await tx.stageHistory.create({
        data: {
          stageId,
          fromStatus: stage.status,
          toStatus: next,
          comment: input.comment ?? null,
          changedById: user.id,
        },
      })
      await recomputeControlStage(tx, stage.cooperationId, user.id)
    }
  })

  if (statusChanged) {
    await writeAudit({
      userId: user.id,
      action: 'stage.status.change',
      objectType: 'WorkflowStage',
      objectId: stageId,
      payload: { from: stage.status, to: next, stageNumber: stage.stageNumber },
    })
  }

  const fresh = await repo.findStageById(stageId)
  if (!fresh) throw notFound('Этап не найден')
  return toStageDto(fresh, now, { hideInternalNotes: !canSeeInternalNotes(user) })
}

/** Отметка пункта чек-листа. Обязательные пункты блокируют завершение этапа. */
export async function toggleTask(
  user: CurrentUser,
  taskId: string,
  input: UpdateTaskInput,
): Promise<WorkflowStageDto> {
  assertCan(user, 'WRITE')

  const task = await repo.findTaskById(taskId)
  if (!task) throw notFound('Пункт чек-листа не найден')
  const taskCooperation = await loadVisibleCooperation(user, task.stage.cooperationId)
  assertCooperationOpen(taskCooperation.status)
  assertTasksEditable(task.stage.status, task.stage.stageNumber)

  await prisma.task.update({
    where: { id: taskId },
    data: {
      isDone: input.isDone,
      doneAt: input.isDone ? new Date() : null,
      doneById: input.isDone ? user.id : null,
    },
  })

  await writeAudit({
    userId: user.id,
    action: 'task.toggle',
    objectType: 'Task',
    objectId: taskId,
    payload: { isDone: input.isDone, stageId: task.stageId },
  })

  const stage = await repo.findStageById(task.stageId)
  if (!stage) throw notFound('Этап не найден')
  return toStageDto(stage, new Date(), { hideInternalNotes: !canSeeInternalNotes(user) })
}

export async function overdue(
  user: CurrentUser,
  query: StageListQuery,
): Promise<{ data: StageWithCooperationDto[]; meta: PageMeta }> {
  assertCan(user, 'READ')
  const now = new Date()
  const { rows, total } = await repo.findOverdue(query, universityScope(user), now)
  const hideInternalNotes = !canSeeInternalNotes(user)
  return {
    data: rows.map((row) => toStageWithCooperationDto(row, now, { hideInternalNotes })),
    meta: pageMeta({ page: query.page, pageSize: query.pageSize }, total),
  }
}

export async function blocked(
  user: CurrentUser,
  query: StageListQuery,
): Promise<{ data: StageWithCooperationDto[]; meta: PageMeta }> {
  assertCan(user, 'READ')
  const now = new Date()
  const { rows, total } = await repo.findBlocked(query, universityScope(user))
  const hideInternalNotes = !canSeeInternalNotes(user)
  return {
    data: rows.map((row) => toStageWithCooperationDto(row, now, { hideInternalNotes })),
    meta: pageMeta({ page: query.page, pageSize: query.pageSize }, total),
  }
}

export async function history(
  user: CurrentUser,
  stageId: string,
): Promise<StageHistoryEntryDto[]> {
  assertCan(user, 'READ')
  const stage = await repo.findStageById(stageId)
  if (!stage) throw notFound('Этап не найден')
  await assertCooperationVisible(user, stage.cooperationId)

  const hideInternalNotes = !canSeeInternalNotes(user)
  const rows = await repo.findHistory(stageId)
  return rows.map((row) => ({
    id: row.id,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    // Смену статуса и её автора вуз видит, внутренний комментарий — нет.
    comment: hideInternalNotes ? null : row.comment,
    changedBy: row.changedBy,
    changedAt: toIsoRequired(row.changedAt),
  }))
}
