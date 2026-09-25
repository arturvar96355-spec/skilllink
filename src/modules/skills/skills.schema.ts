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

// ── Справочник навыков: управление (решение 107, право ADMIN) ──────────────────

/** Пробелы внутри названия сводятся к одному: «Machine   Learning» хранится как «Machine Learning». */
const collapseSpaces = (value: string) => value.replace(/\s+/gu, ' ')

/** База без значений по умолчанию: `.partial()` их не снимает (см. схему продуктов). */
const skillFields = {
  // Одна буква — законное название: языки C и R.
  name: z.string().trim().min(1, 'Укажите название навыка').max(120).transform(collapseSpaces),
  category: z.string().trim().min(1, 'Укажите категорию навыка').max(100).transform(collapseSpaces),
  description: z.string().trim().max(2000).nullish(),
}

export const createSkillSchema = z.object(skillFields)

export type CreateSkillInput = z.infer<typeof createSkillSchema>

export const updateSkillSchema = z
  .object(skillFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Не передано ни одного поля для изменения',
  })

export type UpdateSkillInput = z.infer<typeof updateSkillSchema>

export const mergeSkillSchema = z.object({
  /** Навык, в который объединяется дубль из адреса. Дубль после объединения удаляется. */
  targetId: z.string().trim().min(1, 'Укажите навык, в который объединить'),
})

export type MergeSkillInput = z.infer<typeof mergeSkillSchema>
