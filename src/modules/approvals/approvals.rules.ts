import { createHash } from 'node:crypto'
import { z } from '@/shared/zod'
import { APPROVAL_ACTIONS, type ApprovalAction } from '@/shared/contracts/approval'
import type { UserRole } from '@/shared/contracts/enums'

/**
 * Правила «четырёх глаз» (решение 133) — чистые функции без базы.
 */

const idSchema = z.string().trim().min(1).max(64)

/** Схема параметров каждой операции: только идентификаторы — ПД в одобрения не попадают. */
export const APPROVAL_PAYLOAD_SCHEMAS = {
  'user.grant_admin': z.object({ userId: idSchema }).strict(),
  'user.block_admin': z.object({ userId: idSchema }).strict(),
} as const satisfies Record<ApprovalAction, z.ZodType>

export type ApprovalPayload = Record<string, string | number | boolean | null>

export function isApprovalAction(value: string): value is ApprovalAction {
  return (APPROVAL_ACTIONS as readonly string[]).includes(value)
}

/** JSON с ключами по алфавиту на любой глубине: один и тот же объект — одна строка. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
}

/**
 * Хеш одобряемого: действие и параметры. Одобрение на «назначить администратором
 * Иванова» не подойдёт к «назначить администратором Петрова» и к «заблокировать Иванова».
 */
export function approvalPayloadHash(action: ApprovalAction, payload: ApprovalPayload): string {
  return createHash('sha256').update(canonicalJson({ action, payload })).digest('hex')
}

/**
 * Какие операции над пользователем требуют одобрения — по состоянию до и после:
 * - назначение роли ADMIN тому, у кого её не было;
 * - блокировка действующего администратора (любого — не только последнего:
 *   последнего и так нельзя, auth.rules.assertUserChangeAllowed).
 */
export function userChangeApprovals(
  before: { role: UserRole; isActive: boolean },
  after: { role: UserRole; isActive: boolean },
): ApprovalAction[] {
  const actions: ApprovalAction[] = []
  if (before.role !== 'ADMIN' && after.role === 'ADMIN') actions.push('user.grant_admin')
  if (before.role === 'ADMIN' && before.isActive && !after.isActive) actions.push('user.block_admin')
  return actions
}
