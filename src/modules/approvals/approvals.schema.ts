import { z } from '@/shared/zod'
import { paginationSchema } from '@/shared/http/pagination'
import { APPROVAL_ACTIONS, APPROVAL_STATUSES } from '@/shared/contracts/approval'

/** POST /api/admin/approvals — запросить одобрение операции. */
export const createApprovalSchema = z.object({
  action: z.enum(APPROVAL_ACTIONS),
  /** Параметры операции; проверяются схемой действия (APPROVAL_PAYLOAD_SCHEMAS). */
  payload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
})
export type CreateApprovalInput = z.infer<typeof createApprovalSchema>

export const approvalListQuerySchema = paginationSchema.extend({
  status: z.enum(APPROVAL_STATUSES).optional(),
})
export type ApprovalListQuery = z.infer<typeof approvalListQuerySchema>
