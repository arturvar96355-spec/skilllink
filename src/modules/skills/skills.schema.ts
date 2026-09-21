import { z } from '@/shared/zod'
import { paginationSchema } from '@/shared/http/pagination'

const multi = <S extends z.ZodType>(schema: S) =>
  z.union([schema, z.array(schema)]).transform((value) => (Array.isArray(value) ? value : [value]))

export const skillListQuerySchema = paginationSchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
  category: multi(z.string().trim().min(1)).optional(),
  sort: z.string().optional(),
})

export type SkillListQuery = z.infer<typeof skillListQuerySchema>

export const SKILL_SORT_FIELDS = ['name', 'category', 'createdAt'] as const

export const skillDemandQuerySchema = z.object({
  /** Период вида 2026-Q1 или 2026-03. По умолчанию берётся последний доступный. */
  period: z
    .string()
    .trim()
    .regex(/^\d{4}-(Q[1-4]|(0[1-9]|1[0-2]))$/, 'Период должен быть в формате 2026-Q1 или 2026-03')
    .optional(),
  region: z.string().trim().min(1).max(120).optional(),
  category: multi(z.string().trim().min(1)).optional(),
  skillId: multi(z.string().trim().min(1)).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export type SkillDemandQuery = z.infer<typeof skillDemandQuerySchema>

export const skillGapQuerySchema = z.object({
  /** Дефициты одной программы. Без параметра считается сводка по всем активным программам. */
  programId: z.string().trim().min(1).optional(),
  universityId: z.string().trim().min(1).optional(),
  period: z
    .string()
    .trim()
    .regex(/^\d{4}-(Q[1-4]|(0[1-9]|1[0-2]))$/, 'Период должен быть в формате 2026-Q1 или 2026-03')
    .optional(),
  /** Показывать только критичные дефициты. */
  criticalOnly: z
    .union([z.literal('true'), z.literal('false')])
    .transform((value) => value === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export type SkillGapQuery = z.infer<typeof skillGapQuerySchema>
