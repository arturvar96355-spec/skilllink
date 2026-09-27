import { prisma } from '@/shared/db/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { TIE_BREAKER, toSkipTake } from '@/shared/http/pagination'
import type { ApprovalScope, ApprovalStatus } from '@/shared/contracts/approval'
import type { UserRole } from '@/shared/contracts/enums'

type Client = Prisma.TransactionClient | typeof prisma

const userRef = { select: { id: true, fullName: true, role: true } } as const

export const approvalSelect = {
  id: true,
  action: true,
  payload: true,
  status: true,
  requestedById: true,
  createdAt: true,
  decidedAt: true,
  expiresAt: true,
  consumedAt: true,
  requestedBy: userRef,
  approvedBy: userRef,
  rejectedBy: userRef,
} satisfies Prisma.ApprovalSelect

export type ApprovalRow = Prisma.ApprovalGetPayload<{ select: typeof approvalSelect }>

export async function create(data: {
  action: string
  payload: Prisma.InputJsonValue
  payloadHash: string
  requestedById: string
  expiresAt: Date
}): Promise<ApprovalRow> {
  return prisma.approval.create({ data, select: approvalSelect })
}

export async function findById(id: string): Promise<ApprovalRow | null> {
  return prisma.approval.findUnique({ where: { id }, select: approvalSelect })
}

/** Просроченные ждущие и одобренные — в EXPIRED, чтобы список не врал. */
export async function expireStale(now: Date): Promise<void> {
  await prisma.approval.updateMany({
    where: { status: { in: ['REQUESTED', 'APPROVED'] }, expiresAt: { lte: now } },
    data: { status: 'EXPIRED' },
  })
}

/**
 * Условие вкладки «Согласований» (решение 218). `awaiting` — чужие ждущие и не истёкшие:
 * ровно те, у которых `canApprove` будет true (не считая учётки эксперта).
 */
export function scopeWhere(scope: ApprovalScope | undefined, viewerId: string, now: Date): Prisma.ApprovalWhereInput {
  switch (scope) {
    case 'awaiting':
      return { status: 'REQUESTED', expiresAt: { gt: now }, requestedById: { not: viewerId } }
    case 'mine':
      return { requestedById: viewerId }
    case 'history':
      return { status: { not: 'REQUESTED' } }
    default:
      return {}
  }
}

export async function list(
  query: { status?: ApprovalStatus; scope?: ApprovalScope; page: number; pageSize: number },
  viewerId: string,
  now: Date,
) {
  const where: Prisma.ApprovalWhereInput = {
    ...scopeWhere(query.scope, viewerId, now),
    ...(query.status ? { AND: [{ status: query.status }] } : {}),
  }
  const [rows, total] = await Promise.all([
    prisma.approval.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, TIE_BREAKER],
      select: approvalSelect,
      ...toSkipTake(query),
    }),
    prisma.approval.count({ where }),
  ])
  return { rows, total }
}

/** Счётчики для меню (решение 218): ждут моего решения и мои согласованные, ещё не выполненные. */
export async function summary(viewerId: string, now: Date): Promise<{ awaiting: number; readyToRun: number }> {
  const [awaiting, readyToRun] = await Promise.all([
    prisma.approval.count({ where: scopeWhere('awaiting', viewerId, now) }),
    prisma.approval.count({ where: { status: 'APPROVED', requestedById: viewerId, expiresAt: { gt: now } } }),
  ])
  return { awaiting, readyToRun }
}

export interface ApprovalDetails {
  targets: Map<string, { id: string; fullName: string; role: UserRole; isActive: boolean }>
  /** Причина запроса и причина отказа — из журнала: отдельных колонок нет (решение 218). */
  reasons: Map<string, string>
  rejectReasons: Map<string, string>
}

function reasonOf(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const value = (payload as Record<string, unknown>).reason
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * Над кем операция и причины — одним запросом на страницу. Причины лежат в журнале
 * действий рядом с самим событием (`approval.requested`, `approval.rejected`): схема
 * таблицы одобрений не меняется, а журнал и так отвечает на «кто и зачем».
 */
export async function loadDetails(rows: ReadonlyArray<Pick<ApprovalRow, 'id' | 'payload'>>): Promise<ApprovalDetails> {
  const details: ApprovalDetails = { targets: new Map(), reasons: new Map(), rejectReasons: new Map() }
  if (rows.length === 0) return details
  const userIds = [
    ...new Set(
      rows
        .map((row) => (row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>).userId : null))
        .filter((id): id is string => typeof id === 'string'),
    ),
  ]
  const [users, entries] = await Promise.all([
    userIds.length > 0
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, role: true, isActive: true } })
      : Promise.resolve([]),
    prisma.auditLog.findMany({
      where: {
        objectType: 'Approval',
        objectId: { in: rows.map((row) => row.id) },
        action: { in: ['approval.requested', 'approval.rejected'] },
      },
      orderBy: { createdAt: 'asc' },
      select: { objectId: true, action: true, payload: true },
    }),
  ])
  for (const user of users) details.targets.set(user.id, user)
  for (const entry of entries) {
    const reason = reasonOf(entry.payload)
    if (!reason) continue
    if (entry.action === 'approval.requested') details.reasons.set(entry.objectId, reason)
    else details.rejectReasons.set(entry.objectId, reason)
  }
  return details
}

/**
 * Одобрить: атомарно, только ждущий, не свой и не истёкший. 0 строк — условие
 * не выполнено (кто-то успел раньше, срок вышел, свой запрос).
 */
export async function approve(id: string, approverId: string, now: Date): Promise<boolean> {
  const count = await prisma.$executeRaw`
    UPDATE approvals SET status = 'APPROVED', approved_by_id = ${approverId}, decided_at = ${now}
    WHERE id = ${id} AND status = 'REQUESTED' AND requested_by_id <> ${approverId} AND expires_at > ${now}`
  return count === 1
}

/** Отклонить: ждущий или одобренный, но ещё не использованный. */
export async function reject(id: string, rejectorId: string, now: Date): Promise<boolean> {
  const count = await prisma.$executeRaw`
    UPDATE approvals SET status = 'REJECTED', rejected_by_id = ${rejectorId}, decided_at = ${now}
    WHERE id = ${id} AND status IN ('REQUESTED', 'APPROVED') AND expires_at > ${now}`
  return count === 1
}

/**
 * Использовать одобрение — один раз. Один UPDATE с условием: из двух
 * одновременных попыток пройдёт одна. `client` — транзакция операции: если она
 * откатится, одобрение останется неиспользованным.
 */
export async function consume(
  input: { id: string; action: string; payloadHash: string; requestedById: string },
  now: Date,
  client: Client = prisma,
): Promise<boolean> {
  const count = await client.$executeRaw`
    UPDATE approvals SET status = 'CONSUMED', consumed_at = ${now}
    WHERE id = ${input.id} AND status = 'APPROVED' AND action = ${input.action}
      AND payload_hash = ${input.payloadHash} AND requested_by_id = ${input.requestedById}
      AND expires_at > ${now}`
  return count === 1
}

/** Действующий администратор — для проверки цели запроса. */
export async function findUserForApproval(userId: string) {
  return prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true } })
}
