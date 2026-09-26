import { prisma } from '@/shared/db/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { TIE_BREAKER, toSkipTake } from '@/shared/http/pagination'
import type { ApprovalStatus } from '@/shared/contracts/approval'

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

export async function list(query: { status?: ApprovalStatus; page: number; pageSize: number }) {
  const where: Prisma.ApprovalWhereInput = query.status ? { status: query.status } : {}
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
