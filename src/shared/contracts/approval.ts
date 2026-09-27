import type { PageMeta } from './common'
import type { UserRole } from './enums'
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

/**
 * Вкладки экрана «Согласования» (решение 218) — фильтр `scope` у `GET /api/admin/approvals`:
 * - `awaiting` — ждут решения текущего администратора: чужие, не истёкшие, ещё без решения;
 * - `mine` — запросы текущего администратора в любом статусе;
 * - `history` — все запросы, по которым уже есть решение или вышел срок.
 */
export const APPROVAL_SCOPES = ['awaiting', 'mine', 'history'] as const
export type ApprovalScope = (typeof APPROVAL_SCOPES)[number]

/** Над кем операция: пользователь из `payload.userId` — ФИО и роль сейчас. */
export interface ApprovalTargetDto {
  id: string
  fullName: string
  role: UserRole
  isActive: boolean
}

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
  /** Над кем операция; null — пользователя больше нет в справочнике. */
  target: ApprovalTargetDto | null
  /** Зачем операция — со слов запросившего (решение 218); null — не указал. */
  reason: string | null
  /** Почему отклонено — со слов отклонившего (решение 218); null — не отклонено или без причины. */
  rejectReason: string | null
}

/**
 * Счётчики «Согласований» (решение 218) — в `meta` ответа `GET /api/admin/approvals`
 * при любом фильтре: пункт меню берёт их запросом `?scope=awaiting&pageSize=1`,
 * отдельного маршрута нет.
 */
export interface ApprovalSummaryDto {
  /** Включено ли требование второго администратора (`APPROVALS_REQUIRED`). */
  required: boolean
  /** Сколько запросов ждут решения текущего администратора. */
  awaiting: number
  /** Сколько своих запросов уже согласовано и ждут, когда их выполнят. */
  readyToRun: number
  /** Сколько часов живёт запрос — от создания до использования. */
  ttlHours: number
}

/** `meta` списка `GET /api/admin/approvals`: страница и счётчики экрана (решение 218). */
export interface ApprovalListMetaDto extends PageMeta, ApprovalSummaryDto {}
