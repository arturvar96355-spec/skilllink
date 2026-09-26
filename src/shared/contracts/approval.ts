import type { UserRefDto } from './workflow'

/**
 * «Четыре глаза» для опасных операций (решение 133): операцию запрашивает один
 * администратор, одобряет другой, одобрение срабатывает один раз.
 */

export const APPROVAL_STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', 'CONSUMED', 'EXPIRED'] as const
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number]

/**
 * Операции, которым нужно одобрение (при APPROVALS_REQUIRED=true).
 * - `user.grant_admin` — назначить пользователю роль администратора; payload `{ userId }`;
 * - `user.block_admin` — заблокировать администратора; payload `{ userId }`.
 * Новая операция добавляется сюда, в схему payload (approvals.rules.ts) и в подписи.
 */
export const APPROVAL_ACTIONS = ['user.grant_admin', 'user.block_admin'] as const
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number]

export interface ApprovalDto {
  id: string
  action: ApprovalAction
  /** Параметры операции — только идентификаторы. */
  payload: Record<string, unknown>
  status: ApprovalStatus
  requestedBy: UserRefDto
  approvedBy: UserRefDto | null
  rejectedBy: UserRefDto | null
  createdAt: string
  decidedAt: string | null
  expiresAt: string
  consumedAt: string | null
  /** Текущий пользователь может одобрить: он администратор и не автор запроса, запрос ждёт решения. */
  canApprove: boolean
}
