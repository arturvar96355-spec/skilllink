import { z } from '@/shared/zod'
import { paginationSchema } from '@/shared/http/pagination'
import { STAGE_STATUSES } from '@/shared/contracts/enums'

export const updateStageSchema = z
  .object({
    status: z.enum(STAGE_STATUSES).optional(),
    responsibleId: z.string().trim().min(1).nullish(),
    deadline: z.iso.datetime({ message: 'Дата должна быть в формате ISO 8601' }).nullish(),
    comment: z.string().trim().max(2000).nullish(),
    result: z.string().trim().max(2000).nullish(),
    blockingReason: z.string().trim().max(2000).nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Не передано ни одного поля для изменения',
  })

export type UpdateStageInput = z.infer<typeof updateStageSchema>

export const updateTaskSchema = z.object({
  isDone: z.boolean(),
})

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>

export const stageListQuerySchema = paginationSchema.extend({
  universityId: z.string().trim().min(1).optional(),
  responsibleId: z.string().trim().min(1).optional(),
  /** Сколько дней просрочки минимум. Для блока проблемных связей на дашборде. */
  // Сверху — сто лет: без границы огромное число давало несуществующую дату
  // и внутреннюю ошибку вместо отказа.
  minDaysOverdue: z.coerce.number().int().min(0).max(36_500).optional(),
})

export type StageListQuery = z.infer<typeof stageListQuerySchema>
