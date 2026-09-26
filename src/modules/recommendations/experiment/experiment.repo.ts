import { prisma } from '@/shared/db/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { findCurrentStage } from '@/modules/workflow/workflow.rules'
import type { ExperimentArm } from '@/shared/contracts/recommendation-experiment'
import type { AssignedBy } from './assignment'
import type { Outcome, OutcomeFacts, ProgramEvent, SignalContext, StageClosure } from './outcome'

/** Доступ к журналу сигналов и к фактам для исходов (решение 136). Prisma — только здесь. */

export interface SignalIdentity {
  ruleType: string
  entityType: string
  entityId: string
}

export function signalIdentityKey(row: SignalIdentity): string {
  return `${row.ruleType}::${row.entityType}::${row.entityId}`
}

/** Сигналы по этим правилам и объектам, чьё окно исхода ещё открыто (сработали после `since`). */
export async function findOpenSignals(
  identities: readonly SignalIdentity[],
  since: Date,
): Promise<Map<string, ExperimentArm>> {
  if (identities.length === 0) return new Map()
  const rows = await prisma.recommendationSignal.findMany({
    where: {
      firedAt: { gt: since },
      entityId: { in: [...new Set(identities.map((row) => row.entityId))] },
    },
    select: { ruleType: true, entityType: true, entityId: true, arm: true, firedAt: true },
    orderBy: { firedAt: 'asc' },
  })
  const wanted = new Set(identities.map(signalIdentityKey))
  const result = new Map<string, ExperimentArm>()
  for (const row of rows) {
    const key = signalIdentityKey(row)
    if (wanted.has(key)) result.set(key, row.arm)
  }
  return result
}

/** Рекомендации по тем же ключам — чтобы знать, видел ли её сотрудник до сигнала. */
export async function findPriorRecommendations(
  identities: readonly SignalIdentity[],
): Promise<Map<string, { status: string; resolvedById: string | null; ruleKey: string }>> {
  if (identities.length === 0) return new Map()
  const rows = await prisma.recommendation.findMany({
    where: { objectId: { in: [...new Set(identities.map((row) => row.entityId))] } },
    select: { ruleKey: true, objectType: true, objectId: true, status: true, resolvedById: true },
  })
  return new Map(
    rows.map((row) => [
      signalIdentityKey({ ruleType: row.ruleKey, entityType: row.objectType, entityId: row.objectId }),
      { status: row.status, resolvedById: row.resolvedById, ruleKey: row.ruleKey },
    ]),
  )
}

/** Текущий этап связок в момент сигнала — от него считается «перешла дальше». */
export async function currentStageNumbers(cooperationIds: readonly string[]): Promise<Map<string, number>> {
  if (cooperationIds.length === 0) return new Map()
  const stages = await prisma.workflowStage.findMany({
    where: { cooperationId: { in: [...new Set(cooperationIds)] } },
    select: { cooperationId: true, stageNumber: true, status: true },
  })
  const byCooperation = new Map<string, typeof stages>()
  for (const stage of stages) {
    const list = byCooperation.get(stage.cooperationId) ?? []
    list.push(stage)
    byCooperation.set(stage.cooperationId, list)
  }
  const result = new Map<string, number>()
  for (const [id, list] of byCooperation) {
    const current = findCurrentStage(list)
    if (current) result.set(id, current.stageNumber)
  }
  return result
}

export interface NewSignal extends SignalIdentity {
  periodKey: string
  firedAt: Date
  arm: ExperimentArm
  assignedBy: AssignedBy
  context: SignalContext
}

/**
 * Пишет новые сигналы. Параллельная пересборка могла записать тот же сигнал раньше —
 * уникальный ключ (правило, объект, период) отсечёт дубль, а группа у обоих запусков
 * одна и та же: она считается по хешу.
 */
export async function createSignals(rows: readonly NewSignal[]): Promise<void> {
  if (rows.length === 0) return
  await prisma.recommendationSignal.createMany({
    data: rows.map((row) => ({
      ruleType: row.ruleType,
      entityType: row.entityType,
      entityId: row.entityId,
      periodKey: row.periodKey,
      firedAt: row.firedAt,
      arm: row.arm,
      assignedBy: row.assignedBy,
      context: row.context as Prisma.InputJsonValue,
    })),
    skipDuplicates: true,
  })
}

/** Группы, которые реально лежат в журнале за этот период, — после возможной гонки. */
export async function storedArms(
  identities: readonly SignalIdentity[],
  periodKey: string,
): Promise<Map<string, ExperimentArm>> {
  if (identities.length === 0) return new Map()
  const rows = await prisma.recommendationSignal.findMany({
    where: { periodKey, entityId: { in: [...new Set(identities.map((row) => row.entityId))] } },
    select: { ruleType: true, entityType: true, entityId: true, arm: true },
  })
  return new Map(rows.map((row) => [signalIdentityKey(row), row.arm]))
}

/**
 * Проставляет показанную рекомендацию сигналам группы treatment: связь по ключу
 * рекомендации (правило, тип и id объекта). Контроль не трогается — у него рекомендации нет.
 */
export async function linkRecommendations(): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "recommendation_signals" AS s
       SET "recommendation_id" = r."id"
      FROM "recommendations" AS r
     WHERE s."recommendation_id" IS NULL
       AND s."arm" = 'treatment'
       AND r."rule_key" = s."rule_type"
       AND r."object_type" = s."entity_type"
       AND r."object_id" = s."entity_id"`
}

export interface StoredSignal {
  id: string
  ruleType: string
  entityType: string
  entityId: string
  firedAt: Date
  arm: ExperimentArm
  assignedBy: string
  context: SignalContext | null
  outcomeAt: Date | null
  outcome: Outcome | null
}

interface StoredOutcomeJson {
  state: Outcome['state']
  days: number | null
  event: Outcome['event']
  at: string | null
}

function parseOutcome(value: Prisma.JsonValue | null): Outcome | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as unknown as StoredOutcomeJson
  if (raw.state !== 'success' && raw.state !== 'failure') return null
  return { state: raw.state, days: raw.days ?? null, event: raw.event ?? null, at: raw.at ? new Date(raw.at) : null }
}

/** Журнал сигналов. `onlyUndecided` — только те, чей исход ещё не записан. */
export async function loadSignals(options: { onlyUndecided?: boolean } = {}): Promise<StoredSignal[]> {
  const rows = await prisma.recommendationSignal.findMany({
    where: options.onlyUndecided ? { outcomeAt: null } : {},
    select: {
      id: true,
      ruleType: true,
      entityType: true,
      entityId: true,
      firedAt: true,
      arm: true,
      assignedBy: true,
      context: true,
      outcomeAt: true,
      outcome: true,
    },
    orderBy: { firedAt: 'asc' },
  })
  return rows.map((row) => ({
    ...row,
    context: (row.context as SignalContext | null) ?? null,
    outcome: parseOutcome(row.outcome),
  }))
}

/**
 * Факты для исходов: закрытия этапов связок и новые связки и встречи программ —
 * начиная с первого сигнала. Одним проходом на все сигналы, а не запросом на каждый.
 */
export async function loadOutcomeFacts(
  cooperationIds: readonly string[],
  programIds: readonly string[],
  since: Date,
): Promise<OutcomeFacts> {
  const [closures, cooperations, meetings] = await Promise.all([
    cooperationIds.length
      ? prisma.stageHistory.findMany({
          where: {
            changedAt: { gt: since },
            toStatus: { in: ['COMPLETED', 'CANCELLED'] },
            stage: { cooperationId: { in: [...new Set(cooperationIds)] } },
          },
          select: { changedAt: true, stage: { select: { cooperationId: true, stageNumber: true } } },
        })
      : [],
    programIds.length
      ? prisma.cooperation.findMany({
          where: { createdAt: { gt: since }, programId: { in: [...new Set(programIds)] } },
          select: { programId: true, createdAt: true },
        })
      : [],
    programIds.length
      ? prisma.meeting.findMany({
          where: {
            createdAt: { gt: since },
            OR: [
              { programId: { in: [...new Set(programIds)] } },
              { cooperation: { programId: { in: [...new Set(programIds)] } } },
            ],
          },
          select: { programId: true, createdAt: true, cooperation: { select: { programId: true } } },
        })
      : [],
  ])

  const stageClosures = new Map<string, StageClosure[]>()
  for (const row of closures) {
    const list = stageClosures.get(row.stage.cooperationId) ?? []
    list.push({ stageNumber: row.stage.stageNumber, at: row.changedAt })
    stageClosures.set(row.stage.cooperationId, list)
  }
  const programEvents = new Map<string, ProgramEvent[]>()
  const push = (programId: string | null | undefined, event: ProgramEvent) => {
    if (!programId) return
    const list = programEvents.get(programId) ?? []
    list.push(event)
    programEvents.set(programId, list)
  }
  for (const row of cooperations) push(row.programId, { at: row.createdAt, kind: 'cooperation' })
  for (const row of meetings) {
    push(row.programId ?? row.cooperation?.programId, { at: row.createdAt, kind: 'meeting' })
  }
  return { stageClosures, programEvents }
}

/** Записывает решённые исходы. Ожидающие не пишутся: их пересчитает следующий раз. */
export async function saveOutcomes(updates: ReadonlyArray<{ id: string; outcome: Outcome; evaluatedAt: Date }>) {
  for (const { id, outcome, evaluatedAt } of updates) {
    await prisma.recommendationSignal.updateMany({
      where: { id, outcomeAt: null },
      data: {
        outcomeAt: outcome.at,
        outcome: {
          state: outcome.state,
          days: outcome.days,
          event: outcome.event,
          at: outcome.at?.toISOString() ?? null,
          evaluatedAt: evaluatedAt.toISOString(),
        },
      },
    })
  }
}
