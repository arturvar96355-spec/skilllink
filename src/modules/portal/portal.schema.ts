import { z } from '@/shared/zod'
import { paginationSchema } from '@/shared/http/pagination'
import { APPLICATION_STATUSES } from '@/shared/contracts/enums'

/**
 * Вуз вносит только те показатели, которыми владеет: численность обучающихся
 * и количество групп. Заявки считаются по поданным заявкам, вручную их не правят —
 * иначе рейтинг перестаёт быть объяснимым.
 */
export const updateProgramMetricsSchema = z
  .object({
    studentCount: z.number().int().min(0).nullish(),
    groupCount: z.number().int().min(0).nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Не передано ни одного показателя',
  })

export type UpdateProgramMetricsInput = z.infer<typeof updateProgramMetricsSchema>

export const submitApplicationSchema = z.object({
  programId: z.string().trim().min(1, 'Укажите образовательную программу'),
  /** Количество заявок в записи. Персональных данных обучающихся не передаётся. */
  quantity: z.number().int().min(1, 'Количество должно быть не меньше 1').max(10000),
  comment: z.string().trim().max(1000).nullish(),
  externalRef: z.string().trim().max(200).nullish(),
})

export type SubmitApplicationInput = z.infer<typeof submitApplicationSchema>

export const applicationListQuerySchema = paginationSchema.extend({
  programId: z.string().trim().min(1).optional(),
  status: z.enum(APPLICATION_STATUSES).optional(),
})

export type ApplicationListQuery = z.infer<typeof applicationListQuerySchema>

export const confirmMaterialSchema = z.object({
  comment: z.string().trim().max(500).nullish(),
})

export type ConfirmMaterialInput = z.infer<typeof confirmMaterialSchema>
