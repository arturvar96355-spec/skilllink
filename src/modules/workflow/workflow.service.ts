import { prisma } from '@/shared/db/prisma'
import { AppError, conflict, invalidTransition, notFound } from '@/shared/http/errors'
import { pageMeta } from '@/shared/http/pagination'
import {
  assertCan,
  canSeeInternalNotes,
  isUniversityVisible,
  universityScope,
} from '@/shared/auth/permissions'
import { writeAudit } from '@/shared/audit/audit'
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
import { syncCooperation as syncRecommendations } from '@/modules/recommendations/recommendations.service'
import { assertCooperationOpen, isClosedStatus } from '@/modules/cooperation/cooperation.rules'
import { SIGNING_STAGE_NUMBER, WORKFLOW_STAGES } from '@/shared/config/workflow.config'
import type { SigningChecklistEffectDto } from '@/shared/contracts/document'
import { assertStaffResponsible } from '@/shared/links/entity-links'
import {
  areTasksEditable,
  assertChecklistReady,
  assertControlPointCancellable,
  assertControlPointReady,
  assertStageFieldsComplete,
  assertTasksEditable,
  findBlockingStages,
  historyComment,
  type PriorStageState,
  assertTransition,
  isAutoManaged,
  isDueSoon,
  isOverdue,
  isPlanShifted,
  resolveStageFields,
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
    isPlanShifted: isPlanShifted(row.deadline, row.status, now),
    isDueSoon: isDueSoon(row.deadline, row.status, now),
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
  // Ответственный этапа проверялся только внешним ключом: аналитик, наблюдатель
  // и представитель вуза проходили, а несуществующий id давал ошибку базы.
  // null снимает ответственного — это разрешено.
  if (input.responsibleId) await assertStaffResponsible(input.responsibleId)

  const requiredTasks = stage.tasks.filter((task) => task.isRequired)
  const statusChanged = input.status !== undefined && input.status !== stage.status

  if (input.status !== undefined) {
    // Контрольная точка проверяется до таблицы переходов: сообщение «сначала
    // закройте этапы 4 и 5» полезнее, чем «переход недопустим».
    if (statusChanged && !isAutoManaged(stage.stageNumber)) {
      assertControlPointReady(
        stage.stageNumber,
        input.status,
        await repo.findPriorStages(stage.cooperationId, stage.stageNumber),
      )
    }

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
  // Проверяется и записывается один и тот же итог — а не запрос по отдельности.
  const resulting = resolveStageFields(stage, input)
  assertStageFieldsComplete(resulting)

  const controlChange = await prisma.$transaction(async (tx) => {
    await repo.lockCooperation(tx, stage.cooperationId)

    // Проверки выше — до очереди, чтобы отказ приходил сразу. То, что могли
    // изменить параллельно другие этапы этой связки, проверяется ещё раз здесь.
    if (statusChanged && !isAutoManaged(stage.stageNumber)) {
      assertControlPointReady(
        stage.stageNumber,
        next,
        await repo.findPriorStages(stage.cooperationId, stage.stageNumber, tx),
      )
    }
    if (statusChanged && next === 'CANCELLED') {
      assertControlPointCancellable(
        stage.stageNumber,
        await repo.findLaterStages(stage.cooperationId, stage.stageNumber, tx),
      )
    }
    if (statusChanged && next === 'COMPLETED') {
      const openRequired = await tx.task.count({
        where: { stageId, isRequired: true, isDone: false },
      })
      if (openRequired > 0) {
        throw invalidTransition(
          `Не закрыты обязательные пункты чек-листа: ${requiredTasks.length - openRequired} из ${requiredTasks.length}`,
          { requiredTasksOpen: openRequired },
        )
      }
    }

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
        result: resulting.result,
        blockingReason: resulting.blockingReason,
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
          comment: historyComment(next, resulting, input.comment),
          changedById: user.id,
        },
      })
      return repo.recomputeControlStage(tx, stage.cooperationId, user.id)
    }
    return null
  })
  await repo.auditControlStageChange(controlChange, user.id)

  if (statusChanged) {
    await writeAudit({
      userId: user.id,
      action: 'stage.status.change',
      objectType: 'WorkflowStage',
      objectId: stageId,
      payload: { from: stage.status, to: next, stageNumber: stage.stageNumber },
    })
  } else {
    // Правка полей без смены статуса тоже должна оставлять след.
    //
    // Раньше запись в журнал стояла только под сменой статуса, и перенос срока
    // у уже завершённого этапа проходил бесследно — а он переписывает показатель
    // «этапы, закрытые в срок». Показатель менялся, а по чему — узнать было негде.
    await writeAudit({
      userId: user.id,
      action: 'stage.fields.change',
      objectType: 'WorkflowStage',
      objectId: stageId,
      payload: {
        stageNumber: stage.stageNumber,
        fields: Object.keys(input).filter((key) => key !== 'status'),
      },
    })
  }

  // Рекомендации связки о просрочке и застое сверяются с новым состоянием этапа:
  // завершённый или перенесённый этап не должен висеть «Просроченным» до пересборки.
  // После транзакции этапа и без исключений — сбой сверки смену статуса не отменяет.
  await syncRecommendations(stage.cooperationId)

  const fresh = await repo.findStageById(stageId)
  if (!fresh) throw notFound('Этап не найден')
  return toStageDto(fresh, now, { hideInternalNotes: !canSeeInternalNotes(user) })
}

/**
 * Отметить пункт чек-листа — одна дорога для сотрудника ИТ-Школы и для
 * представителя вуза, подтверждающего получение материалов. Раньше у кабинета
 * вуза была своя запись в обход этих правил: он отмечал пункты завершённого
 * этапа и не вставал в очередь со сменой статусов. Проверки прав и видимости
 * остаются у вызывающего; здесь — то, что должно быть одинаковым у всех.
 *
 * Возвращает, изменилось ли что-то: повторная отметка — не событие.
 */
export async function setTaskDone(
  target: { taskId: string; stageId: string; cooperationId: string },
  isDone: boolean,
  userId: string,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    // В очереди со сменой статусов этой связки (lockCooperation): иначе пункт
    // снимался в тот же миг, когда этап завершали, и завершённый этап оставался
    // с незакрытым обязательным пунктом.
    await repo.lockCooperation(tx, target.cooperationId)
    // Повторная отметка уже отмеченного пункта ничего не меняет. Раньше она
    // переписывала, кто и когда его отметил: подтверждение получения материалов
    // представителем вуза переходило к менеджеру, нажавшему на устаревшей странице.
    // Проверяется до правила закрытого этапа: повтор — не изменение, и повторное
    // подтверждение уже подтверждённого в завершённом этапе остаётся безвредным.
    const fresh = await tx.task.findUnique({ where: { id: target.taskId }, select: { isDone: true } })
    if (!fresh || fresh.isDone === isDone) return false

    const current = await tx.workflowStage.findUnique({
      where: { id: target.stageId },
      select: { status: true, stageNumber: true },
    })
    if (!current) throw notFound('Этап не найден')
    assertTasksEditable(current.status as StageStatus, current.stageNumber)
    // Пункт не отмечается там, куда контрольная точка ещё не пускает: отметка —
    // такое же утверждение о сделанной работе, как начало этапа. Проверка здесь,
    // под блокировкой связки, — её не обойти ни из кабинета вуза, ни одновременным
    // переоткрытием предыдущего этапа. Снять отметку можно всегда.
    if (isDone) {
      assertChecklistReady(
        current.stageNumber,
        isDone,
        await repo.findPriorStages(target.cooperationId, current.stageNumber, tx),
      )
    }

    await tx.task.update({
      where: { id: target.taskId },
      data: {
        isDone,
        doneAt: isDone ? new Date() : null,
        doneById: isDone ? userId : null,
      },
    })
    return true
  })
}

/**
 * Незакрытые этапы, из-за которых пункты этапа пока не отмечаются.
 * Пусто — отмечать можно.
 */
export async function checklistBlockers(stage: {
  cooperationId: string
  stageNumber: number
}): Promise<PriorStageState[]> {
  return findBlockingStages(
    stage.stageNumber,
    await repo.findPriorStages(stage.cooperationId, stage.stageNumber),
  )
}

/** Пункты этапа «Подписание документов», которые закрывает подпись документов (конфиг, TEMP). */
const SIGNING_TASK_TITLES: ReadonlySet<string> = new Set(
  WORKFLOW_STAGES.find((definition) => definition.number === SIGNING_STAGE_NUMBER)
    ?.tasks.filter((task) => task.closedBySignedDocuments)
    .map((task) => task.title) ?? [],
)

/**
 * Документы связки подписаны — пункты этапа 6 «Подписание документов» отмечаются
 * сами (решение 87, ТЗ Артура). Раньше подпись вводилась дважды: статусом
 * документа и галочками в чек-листе.
 *
 * Правила те же, что у отметки руками (`setTaskDone`): закрытая связка, завершённый
 * или отменённый этап и шлагбаум контрольной точки отметку не пускают — тогда
 * пункты не ставятся, а ответ говорит почему. Автор отметки — тот, кто перевёл
 * документ в «Подписан»: у отметки всегда есть автор (правило целостности данных),
 * в журнале — что она пришла от документа.
 *
 * Вызывается после смены статуса документа; отказ шлагбаума здесь — не ошибка.
 */
export async function markTasksBySignedDocuments(
  cooperationId: string,
  userId: string,
  documentId: string,
): Promise<SigningChecklistEffectDto> {
  const effect = (
    outcome: SigningChecklistEffectDto['outcome'],
    marked = 0,
  ): SigningChecklistEffectDto => ({ stageNumber: SIGNING_STAGE_NUMBER, marked, outcome })

  const cooperationStatus = await repo.findCooperationStatus(cooperationId)
  if (!cooperationStatus || isClosedStatus(cooperationStatus)) return effect('cooperation-closed')

  const stage = await repo.findStageByNumber(cooperationId, SIGNING_STAGE_NUMBER)
  if (!stage || !areTasksEditable(stage.status, stage.stageNumber)) return effect('stage-closed')

  const blocking = findBlockingStages(
    stage.stageNumber,
    await repo.findPriorStages(cooperationId, stage.stageNumber),
  )
  if (blocking.length > 0) return effect('locked')

  const targets = stage.tasks.filter((task) => SIGNING_TASK_TITLES.has(task.title) && !task.isDone)
  if (targets.length === 0) return effect('nothing-to-mark')

  let marked = 0
  let refused = false
  for (const task of targets) {
    try {
      const changed = await setTaskDone(
        { taskId: task.id, stageId: stage.id, cooperationId },
        true,
        userId,
      )
      if (!changed) continue
      marked += 1
      await writeAudit({
        userId,
        action: 'task.toggle',
        objectType: 'Task',
        objectId: task.id,
        payload: { isDone: true, stageId: stage.id, source: 'document.signed', documentId },
      })
    } catch (error) {
      // Этап успели закрыть или переоткрыть предыдущий — правило отметки сработало
      // под блокировкой связки. Остальные пункты не трогаем.
      if (!(error instanceof AppError)) throw error
      refused = true
      break
    }
  }

  // Отметка в чек-листе — движение по связке, как у отметки руками.
  if (marked > 0) await syncRecommendations(cooperationId)
  if (marked > 0) return effect('marked', marked)
  return effect(refused ? 'locked' : 'nothing-to-mark')
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

  const changed = await setTaskDone(
    { taskId, stageId: task.stageId, cooperationId: task.stage.cooperationId },
    input.isDone,
    user.id,
  )

  if (changed) {
    await writeAudit({
      userId: user.id,
      action: 'task.toggle',
      objectType: 'Task',
      objectId: taskId,
      payload: { isDone: input.isDone, stageId: task.stageId },
    })
    // Отметка в чек-листе — движение по связке: «без движения» больше неправда.
    await syncRecommendations(task.stage.cooperationId)
  }

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
