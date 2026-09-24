import { webUrlSchema, z } from '@/shared/zod'
import { paginationSchema } from '@/shared/http/pagination'
import { DOCUMENT_STATUSES, DOCUMENT_TYPES } from '@/shared/contracts/enums'

const multi = <S extends z.ZodType>(schema: S) =>
  z.union([schema, z.array(schema)]).transform((value) => (Array.isArray(value) ? value : [value]))

const isoDate = z.iso.datetime({ message: 'Дата должна быть в формате ISO 8601' })

export const DOCUMENT_SORT_FIELDS = ['title', 'status', 'createdAt', 'updatedAt'] as const

export const documentListQuerySchema = paginationSchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
  cooperationId: z.string().trim().min(1).optional(),
  universityId: z.string().trim().min(1).optional(),
  programId: z.string().trim().min(1).optional(),
  type: multi(z.enum(DOCUMENT_TYPES)).optional(),
  status: multi(z.enum(DOCUMENT_STATUSES)).optional(),
  sort: z.string().optional(),
})

export type DocumentListQuery = z.infer<typeof documentListQuerySchema>

/** База без значений по умолчанию: `.partial()` их не снимает. */
const documentFields = {
  type: z.enum(DOCUMENT_TYPES),
  title: z.string().trim().min(3, 'Название должно содержать не менее 3 символов').max(300),
  version: z.string().trim().min(1).max(50),
  /** Ссылка на внешний документ. Загрузка файлов — P2. */
  fileReference: webUrlSchema('Некорректная ссылка на документ: нужна ссылка http или https').nullish(),
  responsibleId: z.string().trim().min(1).nullish(),
  issuedAt: isoDate.nullish(),
}

export const createDocumentSchema = z.object({
  cooperationId: z.string().trim().min(1).nullish(),
  universityId: z.string().trim().min(1).nullish(),
  programId: z.string().trim().min(1).nullish(),
  ...documentFields,
  version: z.string().trim().min(1).max(50).default('1'),
})

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>

export const updateDocumentSchema = z
  .object(documentFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Не передано ни одного поля для изменения',
  })

export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>

export const changeDocumentStatusSchema = z.object({
  status: z.enum(DOCUMENT_STATUSES),
  comment: z.string().trim().max(2000).nullish(),
})

export type ChangeDocumentStatusInput = z.infer<typeof changeDocumentStatusSchema>

/** Сборка пакета документов из шаблонов для связки. */
export const generateDocumentsSchema = z.object({
  /** Какие шаблоны собрать. Без списка берётся пакет по умолчанию. */
  templateKeys: z.array(z.string().trim().min(1)).max(20).optional(),
  /** Пересобрать, даже если документ по этому шаблону уже есть в связке. */
  force: z.boolean().optional(),
})

export type GenerateDocumentsInput = z.infer<typeof generateDocumentsSchema>
