import { z } from '@/shared/zod'
import { MERGE_FIELD_RULES, MERGEABLE_UNIVERSITY_FIELDS } from '@/shared/contracts/data-quality'
import { universityFieldSchemas } from './universities.schema'

const ruleSchema = z.enum(MERGE_FIELD_RULES)

/** Правила по полям: `{ "name": "longest", "website": "most_recent" }`. Не указано — `non_null`. */
const fieldRulesSchema = z
  .object(Object.fromEntries(MERGEABLE_UNIVERSITY_FIELDS.map((field) => [field, ruleSchema.optional()])))
  .strict()
  .partial()

/**
 * Значения для правила `manual` — теми же схемами, что при правке вуза: вручную
 * нельзя записать то, что не прошло бы обычную правку (неверный ИНН, пустое название).
 */
const manualValuesSchema = z
  .object({
    name: universityFieldSchemas.name,
    shortName: universityFieldSchemas.shortName,
    city: universityFieldSchemas.city,
    region: universityFieldSchemas.region,
    address: universityFieldSchemas.address,
    website: universityFieldSchemas.website,
    description: universityFieldSchemas.description,
    directionCount: universityFieldSchemas.directionCount,
    studentCount: universityFieldSchemas.studentCount,
    inn: universityFieldSchemas.inn,
    ogrn: universityFieldSchemas.ogrn,
  })
  .partial()
  .strict()

export const mergeUniversitiesSchema = z
  .object({
    /** Дубль: уйдёт в архив со ссылкой на цель. */
    sourceId: z.string().trim().min(1),
    /** Вуз, который останется. */
    targetId: z.string().trim().min(1),
    fieldRules: fieldRulesSchema.optional(),
    manualValues: manualValuesSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.sourceId === value.targetId) {
      context.addIssue({ code: 'custom', path: ['targetId'], message: 'Вуз нельзя слить сам с собой' })
    }
    for (const [field, rule] of Object.entries(value.fieldRules ?? {})) {
      if (rule === 'manual' && !(value.manualValues && field in value.manualValues)) {
        context.addIssue({
          code: 'custom',
          path: ['manualValues', field],
          message: 'Для правила «вручную» укажите значение поля',
        })
      }
    }
    for (const field of Object.keys(value.manualValues ?? {})) {
      if (value.fieldRules?.[field] !== 'manual') {
        context.addIssue({
          code: 'custom',
          path: ['fieldRules', field],
          message: 'Значение задано вручную, а правило поля не «manual»',
        })
      }
    }
  })

export type MergeUniversitiesInput = z.infer<typeof mergeUniversitiesSchema>
