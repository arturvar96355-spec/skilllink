import { z } from '@/shared/zod'
import { paginationSchema } from '@/shared/http/pagination'
import { APPROVAL_ACTIONS, APPROVAL_SCOPES, APPROVAL_STATUSES } from '@/shared/contracts/approval'

/**
 * Причина — свободный текст для второго администратора (решение 218). Пустая строка —
 * «не указал»: форма шлёт поле всегда. В журнале хранится вместе с событием.
 */
const reasonSchema = z
  .string()
  .trim()
  .max(500, 'Причина — не длиннее 500 знаков')
  .transform((value) => (value ? value : undefined))
  .optional()

/** POST /api/admin/approvals — запросить одобрение операции. */
export const createApprovalSchema = z.object({
  action: z.enum(APPROVAL_ACTIONS),
  /** Параметры операции; проверяются схемой действия (APPROVAL_PAYLOAD_SCHEMAS). */
  payload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  /** Зачем операция — увидит согласующий. */
  reason: reasonSchema,
})
export type CreateApprovalInput = z.infer<typeof createApprovalSchema>

/** POST /api/admin/approvals/{id}/reject — тело необязательно. */
export const rejectApprovalSchema = z.object({
  /** Почему отклонено — увидит запросивший. */
  reason: reasonSchema,
})
export type RejectApprovalInput = z.infer<typeof rejectApprovalSchema>

export const approvalListQuerySchema = paginationSchema.extend({
  status: z.enum(APPROVAL_STATUSES).optional(),
  /** Вкладка экрана «Согласования» (решение 218): ждут меня, мои, история. */
  scope: z.enum(APPROVAL_SCOPES).optional(),
})
export type ApprovalListQuery = z.infer<typeof approvalListQuerySchema>
