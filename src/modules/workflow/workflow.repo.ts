import { prisma } from '@/shared/db/prisma'
import { moscowDayStart } from '@/shared/utils/date'
import { writeAudit } from '@/shared/audit/audit'
import { intersectUniversityFilter } from '@/shared/auth/scope'
import { TIE_BREAKER, toSkipTake } from '@/shared/http/pagination'
import type { Prisma } from '@/generated/prisma/client'
import type { StageStatus } from '@/shared/contracts/enums'
import { OPEN_COOPERATION_STATUSES } from '@/modules/cooperation/cooperation.rules'
import { CONTROL_STAGE_NUMBER } from '@/shared/config/workflow.config'
import { OVERDUE_STAGE_STATUSES, computeControlStatus } from './workflow.rules'
import type { StageListQuery } from './workflow.schema'

const userRefSelect = { id: true, fullName: true, role: true } satisfies Prisma.UserSelect

const stageSelect = {
  id: true,
  cooperationId: true,
  stageNumber: true,
  title: true,
  phase: true,
  status: true,
  deadline: true,
  comment: true,
  result: true,
  blockingReason: true,
  startedAt: true,
  completedAt: true,
  updatedAt: true,
  responsible: { select: userRefSelect },
  completedBy: { select: userRefSelect },
  tasks: {
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      title: true,
      isRequired: true,
      isDone: true,
      doneAt: true,
      sortOrder: true,
      doneBy: { select: userRefSelect },
    },
  },
} satisfies Prisma.WorkflowStageSelect

const stageWithCooperationSelect = {
  ...stageSelect,
  cooperation: {
    select: {
      id: true,
      university: { select: { id: true, name: true } },
      program: { select: { id: true, name: true } },
      product: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.WorkflowStageSelect

export type StageRow = Prisma.WorkflowStageGetPayload<{ select: typeof stageSelect }>
export type StageWithCooperationRow = Prisma.WorkflowStageGetPayload<{
  select: typeof stageWithCooperationSelect
}>

export async function findStageById(id: string): Promise<StageRow | null> {
  return prisma.workflowStage.findUnique({ where: { id }, select: stageSelect })
}

export async function findStageWithCooperation(
  id: string,
): Promise<StageWithCooperationRow | null> {
  return prisma.workflowStage.findUnique({ where: { id }, select: stageWithCooperationSelect })
}

export async function findStagesByCooperation(cooperationId: string): Promise<StageRow[]> {
  return prisma.workflowStage.findMany({
    where: { cooperationId },
    select: stageSelect,
    orderBy: { stageNumber: 'asc' },
  })
}

/** Просроченные этапы: срок прошёл, а этап в работе или заблокирован (`isOverdue`). */
export async function findOverdue(
  query: StageListQuery,
  scope: { universityId?: string },
  now: Date,
): Promise<{ rows: StageWithCooperationRow[]; total: number }> {
  // «Просрочен не меньше N дней» — по московскому календарю, как бейдж «−N дн.»
  // (решение 47). Раньше — по 24 часа: этап с бейджем «−1 дн.» не попадал
  // в выборку `minDaysOverdue=1`, пока не пройдут сутки с часа срока.
  const deadlineBefore =
    query.minDaysOverdue && query.minDaysOverdue > 0
      ? moscowDayStart(now, 1 - query.minDaysOverdue)
      : now

  const cooperationFilter = buildCooperationFilter(query, scope)
  // Спросили о чужом вузе — пустой ответ, а не «фильтра нет». Разлить `null`
  // через спред нельзя: в объекте это ничего не добавляет, и выборка стала бы
  // выборкой по всем вузам.
  if (cooperationFilter === null) return { rows: [], total: 0 }

  const where: Prisma.WorkflowStageWhereInput = {
    deadline: { lt: deadlineBefore },
    status: { in: [...OVERDUE_STAGE_STATUSES] },
    ...cooperationFilter,
  }

  const [rows, total] = await Promise.all([
    prisma.workflowStage.findMany({
      where,
      select: stageWithCooperationSelect,
      orderBy: [{ deadline: 'asc' }, TIE_BREAKER],
      ...toSkipTake({ page: query.page, pageSize: query.pageSize }),
    }),
    prisma.workflowStage.count({ where }),
  ])
  return { rows, total }
}

export async function findBlocked(
  query: StageListQuery,
  scope: { universityId?: string },
): Promise<{ rows: StageWithCooperationRow[]; total: number }> {
  const blockedFilter = buildCooperationFilter(query, scope)
  if (blockedFilter === null) return { rows: [], total: 0 }

  const where: Prisma.WorkflowStageWhereInput = {
    status: 'BLOCKED',
    ...blockedFilter,
  }

  const [rows, total] = await Promise.all([
    prisma.workflowStage.findMany({
      where,
      select: stageWithCooperationSelect,
      orderBy: [{ updatedAt: 'desc' }, TIE_BREAKER],
      ...toSkipTake({ page: query.page, pageSize: query.pageSize }),
    }),
    prisma.workflowStage.count({ where }),
  ])
  return { rows, total }
}

/**
 * Ограничение выборки этапов по связке.
 *
 * Закрытые связки исключаются всегда: их этапы заморожены, изменить их нельзя,
 * и показывать их как просроченные значит просить сделать то, что система же
 * и запрещает. Раньше закрытая связка оставалась в списках просроченных навсегда.
 */
function buildCooperationFilter(
  query: StageListQuery,
  scope: { universityId?: string },
): Prisma.WorkflowStageWhereInput | null {
  // Пересечение, а не «моя область важнее запроса».
  //
  // Было `scope.universityId ?? query.universityId`: представитель вуза,
  // спросивший о чужом вузе, получал СВОИ записи под чужой подписью. Утечки
  // не происходило, но ответ отвечал не на заданный вопрос — а это хуже пустого
  // ответа, потому что выглядит правдоподобно.
  const universityFilter = intersectUniversityFilter(scope, query.universityId)
  if (universityFilter === null) return null

  const universityId = universityFilter.universityId
  return {
    // Контрольный этап вычисляется автоматически и вручную не меняется (решение 2).
    // В списке дел ему не место: он просрочен ровно потому, что не закрыты этапы
    // 1–13, а они в списке уже есть. Оставить его — значит посчитать одну
    // и ту же задержку дважды и предложить действие, которое система запрещает.
    stageNumber: { not: CONTROL_STAGE_NUMBER },
    cooperation: {
      status: { in: [...OPEN_COOPERATION_STATUSES] },
      ...(universityId ? { universityId } : {}),
      ...(query.responsibleId ? { responsibleId: query.responsibleId } : {}),
    },
  }
}

export async function findTaskById(id: string) {
  return prisma.task.findUnique({
    where: { id },
    select: {
      id: true,
      stageId: true,
      isDone: true,
      isRequired: true,
      stage: { select: { id: true, status: true, stageNumber: true, cooperationId: true } },
    },
  })
}

export async function findHistory(stageId: string) {
  return prisma.stageHistory.findMany({
    where: { stageId },
    orderBy: { changedAt: 'desc' },
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      comment: true,
      changedAt: true,
      changedBy: { select: userRefSelect },
    },
  })
}

/**
 * Состояния этапов, предшествующих указанному. Нужны для проверки контрольной точки.
 *
 * Берутся именно предшествующие, а не все: этапы после контрольной точки её
 * не касаются, и подтягивать их значит притворяться, что порядок жёсткий целиком.
 */
/** Этапы связки после `stageNumber` — для проверки отмены контрольной точки. */
export async function findLaterStages(
  cooperationId: string,
  stageNumber: number,
  client: Prisma.TransactionClient = prisma,
): Promise<Array<{ stageNumber: number; title: string; status: StageStatus }>> {
  return client.workflowStage.findMany({
    where: { cooperationId, stageNumber: { gt: stageNumber } },
    select: { stageNumber: true, title: true, status: true },
    orderBy: { stageNumber: 'asc' },
  })
}

export async function findPriorStages(
  cooperationId: string,
  stageNumber: number,
  client: Prisma.TransactionClient = prisma,
): Promise<Array<{ stageNumber: number; title: string; status: StageStatus }>> {
  return client.workflowStage.findMany({
    where: { cooperationId, stageNumber: { lt: stageNumber } },
    select: { stageNumber: true, title: true, status: true },
    orderBy: { stageNumber: 'asc' },
  })
}

/**
 * Очередь на изменения этапов одной связки.
 *
 * Этапы связки зависят друг от друга: этап 14 считается по остальным, контрольная
 * точка — по предыдущим, завершение — по чек-листу. Проверка шла вне транзакции,
 * а транзакция ничего не блокировала: два менеджера, одновременно закрывшие
 * этапы 12 и 13, оставляли этап 14 «в работе» при закрытых 1–13 — каждый видел
 * чужой этап ещё открытым. Снятие обязательного пункта одновременно с завершением
 * этапа давало завершённый этап с незакрытым пунктом.
 *
 * Блокировка строки связки выстраивает такие транзакции в очередь; всё, что
 * проверяется после неё, видит уже записанное предыдущими.
 */
export async function lockCooperation(
  tx: Prisma.TransactionClient,
  cooperationId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM cooperations WHERE id = ${cooperationId} FOR UPDATE`
}

/**
 * Пересчёт контрольного этапа 14 по состоянию этапов 1–13 (решение 2).
 * Вызывается после любого изменения статуса обычного этапа.
 */
/** Как изменился контрольный этап — для журнала, который пишется после транзакции. */
export interface ControlStageChange {
  stageId: string
  cooperationId: string
  from: StageStatus
  to: StageStatus
}

export async function recomputeControlStage(
  tx: Prisma.TransactionClient,
  cooperationId: string,
  userId: string,
): Promise<ControlStageChange | null> {
  const stages = await tx.workflowStage.findMany({
    where: { cooperationId },
    select: { id: true, stageNumber: true, status: true },
  })

  const control = stages.find((stage) => stage.stageNumber === CONTROL_STAGE_NUMBER)
  if (!control) return null

  const others = stages
    .filter((stage) => stage.stageNumber !== CONTROL_STAGE_NUMBER)
    .map((stage) => stage.status as StageStatus)

  const next = computeControlStatus(others)
  if (next === control.status) return null

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

  return { stageId: control.id, cooperationId, from: control.status as StageStatus, to: next }
}

/**
 * Запись в журнал об автоматическом пересчёте этапа 14.
 *
 * Обещана в SECURITY_LIMITATIONS, а не писалась. Пишется после транзакции:
 * сбой вставки внутри неё оборвал бы саму смену статуса.
 */
export async function auditControlStageChange(
  change: ControlStageChange | null,
  userId: string,
): Promise<void> {
  if (!change) return
  await writeAudit({
    userId,
    action: 'stage.auto.recompute',
    objectType: 'WorkflowStage',
    objectId: change.stageId,
    payload: { cooperationId: change.cooperationId, from: change.from, to: change.to },
  })
}
