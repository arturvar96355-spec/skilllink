import { dateBoundarySchema, z } from '@/shared/zod'
import { CONTROL_STAGE_NUMBER } from '@/shared/config/workflow.config'

/** Параметры запросов аналитики этапов (решение 120). */

const stageNumber = z.coerce
  .number()
  .int()
  .min(1)
  .max(CONTROL_STAGE_NUMBER - 1, 'Этап 14 вычисляется автоматически: у него нет своего порога')

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
  /**
   * Связки, начатые не раньше даты (включительно). Дата без времени
   * разворачивается в московские сутки тем же `dateBoundarySchema`, что
   * и в отчётах (решение 187) — иначе связка, начатая в 01:00 по Москве
   * 1 января (22:00 UTC 31 декабря), не попадала бы в период «с 1 января».
   */
  from: dateBoundarySchema('start').optional(),
  /**
   * Связки, начатые не позже даты (включительно). Дата без времени
   * разворачивается в конец московских суток тем же `dateBoundarySchema` —
   * иначе связка, начатая поздно вечером по Москве в последний день периода,
   * могла выпасть из него из-за более раннего среза по UTC.
   */
  to: dateBoundarySchema('end').optional(),
  /** Разрез: регион, город, вуз, IT-продукт, уровень программы. */
  groupBy: z.enum(FUNNEL_GROUP_BY).optional(),
  /** true — шесть вех вместо четырнадцати этапов. */
  milestones: flag.optional(),
})

export type FunnelQuery = z.infer<typeof funnelQuerySchema>
