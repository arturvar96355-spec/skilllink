import { writeAudit } from '@/shared/audit/audit'
import { assertCan } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import { APPROVALS, approvalsRequired } from '@/shared/config/approvals.config'
import type { PageMeta } from '@/shared/contracts/common'
import type { ApprovalAction, ApprovalDto } from '@/shared/contracts/approval'
import type { Prisma } from '@/generated/prisma/client'
import type { prisma } from '@/shared/db/prisma'
import { AppError, conflict, notFound, validationError } from '@/shared/http/errors'
import { pageMeta } from '@/shared/http/pagination'
import { toIso, toIsoRequired } from '@/shared/utils/date'
import * as repo from './approvals.repo'
import {
  APPROVAL_PAYLOAD_SCHEMAS,
  approvalPayloadHash,
  type ApprovalPayload,
} from './approvals.rules'
import type { ApprovalListQuery, CreateApprovalInput } from './approvals.schema'

/**
 * «Четыре глаза» для опасных операций (решение 123).
 *
 * Поток: администратор A запрашивает операцию (`request`) → администратор B,
 * не A, одобряет (`approve`) → A выполняет операцию, передав `approvalId`,
 * и операция вызывает `requireApproval` — одобрение используется ровно один раз,
 * в той же транзакции, что и сама операция.
 *
 * Выключено по умолчанию (APPROVALS_REQUIRED): `requireApproval` тогда ничего
 * не требует, а API одобрений работает — его можно опробовать заранее.
 */

type Client = Prisma.TransactionClient | typeof prisma

function toDto(row: repo.ApprovalRow, viewer: CurrentUser, now: Date): ApprovalDto {
  return {
    id: row.id,
    action: row.action as ApprovalAction,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    status: row.status,
    requestedBy: row.requestedBy,
    approvedBy: row.approvedBy,
    rejectedBy: row.rejectedBy,
    createdAt: toIsoRequired(row.createdAt),
    decidedAt: toIso(row.decidedAt),
    expiresAt: toIsoRequired(row.expiresAt),
    consumedAt: toIso(row.consumedAt),
    canApprove: row.status === 'REQUESTED' && row.requestedById !== viewer.id && row.expiresAt > now,
  }
}

function parsePayload(action: ApprovalAction, payload: unknown): ApprovalPayload {
  const parsed = APPROVAL_PAYLOAD_SCHEMAS[action].safeParse(payload)
  if (!parsed.success) {
    throw validationError('Параметры операции не подходят к действию', [
      { field: 'payload', message: `Для «${action}» нужен объект { userId }` },
    ])
  }
  return parsed.data as ApprovalPayload
}

/** Цель операции над пользователем должна существовать и подходить к действию. */
async function assertTarget(action: ApprovalAction, payload: ApprovalPayload): Promise<void> {
  const target = await repo.findUserForApproval(String(payload.userId))
  if (!target) throw notFound('Пользователь не найден')
  if (action === 'user.grant_admin' && target.role === 'ADMIN') {
    throw conflict('Пользователь уже администратор')
  }
  if (action === 'user.block_admin' && !(target.role === 'ADMIN' && target.isActive)) {
    throw conflict('Одобрение нужно только для блокировки действующего администратора')
  }
}

export async function request(user: CurrentUser, input: CreateApprovalInput, now = new Date()): Promise<ApprovalDto> {
  assertCan(user, 'ADMIN')
  const payload = parsePayload(input.action, input.payload)
  await assertTarget(input.action, payload)
  const row = await repo.create({
    action: input.action,
    payload,
    payloadHash: approvalPayloadHash(input.action, payload),
    requestedById: user.id,
    expiresAt: new Date(now.getTime() + APPROVALS.ttlMs),
  })
  await writeAudit({
    userId: user.id,
    action: 'approval.requested',
    objectType: 'Approval',
    objectId: row.id,
    payload: { action: input.action, ...payload },
  })
  return toDto(row, user, now)
}

export async function list(
  user: CurrentUser,
  query: ApprovalListQuery,
  now = new Date(),
): Promise<{ data: ApprovalDto[]; meta: PageMeta }> {
  assertCan(user, 'ADMIN')
  await repo.expireStale(now)
  const { rows, total } = await repo.list(query)
  return { data: rows.map((row) => toDto(row, user, now)), meta: pageMeta(query, total) }
}

/** Почему решение не прошло — по перечитанной записи, для понятного ответа. */
function decisionRefusal(row: repo.ApprovalRow, user: CurrentUser, now: Date, approving: boolean): AppError {
  if (row.expiresAt <= now) return conflict('Срок запроса истёк — запросите одобрение заново')
  if (approving && row.requestedById === user.id) {
    return conflict('Свой запрос одобрить нельзя: одобряет другой администратор')
  }
  return conflict(`Запрос уже не ждёт решения (статус ${row.status})`)
}

export async function approve(user: CurrentUser, id: string, now = new Date()): Promise<ApprovalDto> {
  assertCan(user, 'ADMIN')
  const before = await repo.findById(id)
  if (!before) throw notFound('Запрос на одобрение не найден')
  if (!(await repo.approve(id, user.id, now))) {
    throw decisionRefusal((await repo.findById(id)) ?? before, user, now, true)
  }
  await writeAudit({
    userId: user.id,
    action: 'approval.approved',
    objectType: 'Approval',
    objectId: id,
    payload: { action: before.action, requestedBy: before.requestedById },
  })
  return toDto((await repo.findById(id))!, user, now)
}

export async function reject(user: CurrentUser, id: string, now = new Date()): Promise<ApprovalDto> {
  assertCan(user, 'ADMIN')
  const before = await repo.findById(id)
  if (!before) throw notFound('Запрос на одобрение не найден')
  if (!(await repo.reject(id, user.id, now))) {
    throw decisionRefusal((await repo.findById(id)) ?? before, user, now, false)
  }
  await writeAudit({
    userId: user.id,
    action: 'approval.rejected',
    objectType: 'Approval',
    objectId: id,
    payload: { action: before.action, requestedBy: before.requestedById },
  })
  return toDto((await repo.findById(id))!, user, now)
}

// ──────────────── Точка подключения для опасных операций ────────────────

export interface ApprovalContext {
  /** Кто выполняет операцию — тот же администратор, что запрашивал одобрение. */
  actor: CurrentUser
  /** Идентификатор одобрения из запроса операции (поле `approvalId`). */
  approvalId?: string | null
}

/** Ошибка «нужно одобрение»: 403 с признаком в details — фронт по нему предлагает запросить. */
export function approvalRequiredError(action: ApprovalAction, message: string): AppError {
  return new AppError('FORBIDDEN', message, { approvalRequired: true, action })
}

/**
 * Потребовать одобрение операции (решение 123). Выключено (APPROVALS_REQUIRED
 * не true) — ничего не делает и возвращает false.
 *
 * Включено: без `approvalId` — 403 `{ approvalRequired: true, action }`; с ним —
 * атомарное использование одобрения, выданного на ровно это действие и эти
 * параметры, этим администратором, другим администратором одобренного, не
 * истёкшего и не использованного. Не подошло — тот же 403. Использование пишется
 * в журнал (`approval.consumed`).
 *
 * `client` — транзакция самой операции: откатится операция — одобрение останется
 * неиспользованным. Подключение для новой операции (например, обезличивания
 * пользователя): действие в APPROVAL_ACTIONS и схема payload в approvals.rules.ts,
 * затем `await requireApproval('user.anonymize', { userId }, { actor, approvalId }, tx)`
 * до изменения данных.
 */
export async function requireApproval(
  action: ApprovalAction,
  payload: ApprovalPayload,
  context: ApprovalContext,
  client?: Client,
  now = new Date(),
): Promise<boolean> {
  if (!approvalsRequired()) return false
  if (!context.approvalId) {
    throw approvalRequiredError(action, 'Операцию должен одобрить второй администратор: запросите одобрение')
  }
  const consumed = await repo.consume(
    { id: context.approvalId, action, payloadHash: approvalPayloadHash(action, payload), requestedById: context.actor.id },
    now,
    client,
  )
  if (!consumed) {
    throw approvalRequiredError(
      action,
      'Одобрение не подходит: не одобрено другим администратором, выдано на другую операцию или другому администратору, истекло или уже использовано',
    )
  }
  await writeAudit(
    {
      userId: context.actor.id,
      action: 'approval.consumed',
      objectType: 'Approval',
      objectId: context.approvalId,
      payload: { action, ...payload },
    },
    client,
  )
  return true
}
