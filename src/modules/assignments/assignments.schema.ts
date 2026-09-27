import { z } from '@/shared/zod'
import { paginationSchema } from '@/shared/http/pagination'
import { ASSIGNMENT_PRIORITIES, ASSIGNMENT_STATUSES } from '@/shared/contracts/enums'
import { isCalendarDate } from './assignments.rules'

/** Длина текста поручения — та же, что у CHECK `assignments_text_check`. */
export const ASSIGNMENT_TEXT_MAX = 300

const multi = <S extends z.ZodType>(schema: S) =>
  z.union([schema, z.array(schema)]).transform((value) => (Array.isArray(value) ? value : [value]))

const id = z.string().trim().min(1)

const text = z
  .string({ error: 'Опишите, что сделать' })
  .trim()
  .min(1, 'Опишите, что сделать')
  .max(ASSIGNMENT_TEXT_MAX, `Не длиннее ${ASSIGNMENT_TEXT_MAX} символов`)

/** Срок — календарная дата `ГГГГ-ММ-ДД`; «не в прошлом» проверяет сервис по московской дате. */
const dueDate = z
  .string({ error: 'Укажите срок' })
  .trim()
  .min(1, 'Укажите срок')
  .refine(isCalendarDate, 'Срок — дата в формате ГГГГ-ММ-ДД')

export const createAssignmentSchema = z.object({
  assigneeId: z.string({ error: 'Выберите, кому поручить' }).trim().min(1, 'Выберите, кому поручить'),
  text,
  universityId: id.nullish(),
  cooperationId: id.nullish(),
  dueDate,
  priority: z.enum(ASSIGNMENT_PRIORITIES).default('NORMAL'),
})

export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>

/**
 * Автор меняет любые поля, исполнитель — только `status`: кто что может, решает сервис
 * (`AUTHOR_ONLY_FIELDS`), схема лишь проверяет значения.
 */
export const updateAssignmentSchema = z
  .object({
    assigneeId: id,
    text,
    universityId: id.nullable(),
    cooperationId: id.nullable(),
    dueDate,
    priority: z.enum(ASSIGNMENT_PRIORITIES),
    status: z.enum(ASSIGNMENT_STATUSES),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Не передано ни одного поля для изменения' })

export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>

export const assignmentListQuerySchema = paginationSchema.extend({
  /** Чьи поручения. Сотрудник без права видеть чужие получает только свои. */
  assigneeId: id.optional(),
  status: multi(z.enum(ASSIGNMENT_STATUSES)).optional(),
  /** Только просроченные: не сделано и срок раньше сегодняшней московской даты. */
  overdue: z
    .union([z.literal('true'), z.literal('false')])
    .transform((value) => value === 'true')
    .optional(),
})

export type AssignmentListQuery = z.infer<typeof assignmentListQuerySchema>
