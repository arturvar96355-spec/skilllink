import { z } from '@/shared/zod'
import { CONTROL_STAGE_NUMBER } from '@/shared/config/workflow.config'

/** Параметры запросов аналитики этапов (решение 120). */

const stageNumber = z.coerce
  .number()
  .int()
  .min(1)
  .max(CONTROL_STAGE_NUMBER - 1, 'Этап 14 вычисляется автоматически: у него нет своего порога')

const dateParam = z.union([
  z.iso.date({ message: 'Дата должна быть в формате ГГГГ-ММ-ДД или ISO 8601' }),
  z.iso.datetime({ message: 'Дата должна быть в формате ГГГГ-ММ-ДД или ISO 8601' }),
])

const flag = z
  .union([z.literal('true'), z.literal('false')])
  .transform((value) => value === 'true')

export const stalledPreviewQuerySchema = z.object({
  /** Этап; без него предлагаемый порог применяется ко всем этапам. */
  stage: stageNumber.optional(),
  /** Предлагаемый порог, дней без движения. */
  days: z.coerce.number().int().min(1).max(365),
})

export type StalledPreviewQuery = z.infer<typeof stalledPreviewQuerySchema>

export const FUNNEL_GROUP_BY = ['region', 'city', 'university', 'product', 'programLevel'] as const

export const funnelQuerySchema = z.object({
  /** Связки, начатые не раньше даты (включительно). */
  from: dateParam.optional(),
  /** Связки, начатые раньше даты (не включительно). */
  to: dateParam.optional(),
  /** Разрез: регион, город, вуз, IT-продукт, уровень программы. */
  groupBy: z.enum(FUNNEL_GROUP_BY).optional(),
  /** true — шесть вех вместо четырнадцати этапов. */
  milestones: flag.optional(),
})

export type FunnelQuery = z.infer<typeof funnelQuerySchema>
