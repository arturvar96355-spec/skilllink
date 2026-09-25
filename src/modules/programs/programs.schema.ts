import { countSchema, z } from '@/shared/zod'
import { paginationSchema } from '@/shared/http/pagination'
import {
  DATA_ORIGINS,
  PROGRAM_LEVELS,
  PROGRAM_STATUSES,
  SKILL_IMPORTANCE,
  SKILL_LEVELS,
  CONFIDENCE_LEVELS,
} from '@/shared/contracts/enums'

const levelSchema = z.enum(PROGRAM_LEVELS)
const statusSchema = z.enum(PROGRAM_STATUSES)

const multi = <S extends z.ZodType>(schema: S) =>
  z.union([schema, z.array(schema)]).transform((value) => (Array.isArray(value) ? value : [value]))

export const PROGRAM_SORT_FIELDS = [
  'name',
  'level',
  'status',
  'applicationCount',
  'studentCount',
  'groupCount',
  'createdAt',
  'updatedAt',
] as const

export const programListQuerySchema = paginationSchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
  universityId: z.string().trim().min(1).optional(),
  level: multi(levelSchema).optional(),
  status: multi(statusSchema).optional(),
  skillId: multi(z.string().trim().min(1)).optional(),
  sort: z.string().optional(),
  includeArchived: z
    .union([z.literal('true'), z.literal('false')])
    .transform((value) => value === 'true')
    .optional(),
})

export type ProgramListQuery = z.infer<typeof programListQuerySchema>

/**
 * Показатели набора необязательны и могут быть null.
 * null — это «Нет данных», а не ноль.
 */
const metricsSchema = {
  applicationCount: countSchema().nullish(),
  studentCount: countSchema().nullish(),
  groupCount: countSchema().nullish(),
  metricsSource: z.enum(DATA_ORIGINS).nullish(),
}

/** База без значений по умолчанию: `.partial()` их не снимает (см. схему вузов). */
const programFields = {
  name: z.string().trim().min(3, 'Название должно содержать не менее 3 символов').max(300),
  code: z.string().trim().max(50).nullish(),
  direction: z.string().trim().max(200).nullish(),
  level: levelSchema,
  durationMonths: z.number().int().min(1).max(120).nullish(),
  status: statusSchema,
  ...metricsSchema,
}

export const createProgramSchema = z.object({
  universityId: z.string().trim().min(1, 'Укажите вуз'),
  ...programFields,
  status: statusSchema.default('ACTIVE'),
})

export type CreateProgramInput = z.infer<typeof createProgramSchema>

export const updateProgramSchema = z
  .object(programFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Не передано ни одного поля для изменения',
  })

export type UpdateProgramInput = z.infer<typeof updateProgramSchema>

export const programSkillInputSchema = z.object({
  skillId: z.string().trim().min(1, 'Укажите навык'),
  level: z.enum(SKILL_LEVELS).default('BASIC'),
  importance: z.enum(SKILL_IMPORTANCE).default('MEDIUM'),
  source: z.enum(DATA_ORIGINS).default('CURRICULUM'),
  confidence: z.enum(CONFIDENCE_LEVELS).nullish(),
  comment: z.string().trim().max(500).nullish(),
})

/** Полная замена набора навыков программы. */
export const setProgramSkillsSchema = z.object({
  skills: z.array(programSkillInputSchema).max(100),
})

export type SetProgramSkillsInput = z.infer<typeof setProgramSkillsSchema>
