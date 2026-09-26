import { z } from '@/shared/zod'
import { legalEntityInnSchema } from '@/shared/validation/inn-ogrn'

/**
 * Приём данных извне — сайт и LMS (решение 145, ТЗ функц. требования п.5).
 *
 * Контракт — примерный: заказчик его ещё не согласовал (об этом прямо сказано
 * в самом ТЗ), поэтому здесь только поля из примера в задании плюс минимум сверх
 * него, без которого нельзя завести вуз и программу в системе (`city`/`region`
 * у вуза, `level` у программы — необязательны в этом контракте и заполняются
 * плейсхолдером, если не пришли: docs/API_CONTRACT.md, раздел «Приём данных извне»).
 */

export const EXTERNAL_IMPORT_SOURCES = ['site', 'lms'] as const
export type ExternalImportSource = (typeof EXTERNAL_IMPORT_SOURCES)[number]

const universitySchema = z.object({
  name: z.string().trim().min(3, 'Название вуза должно содержать не менее 3 символов').max(300),
  inn: legalEntityInnSchema.nullish(),
  /** Не из примерного контракта ТЗ — необязательное уточнение сверх минимума. */
  city: z.string().trim().min(2).max(120).nullish(),
  region: z.string().trim().min(2).max(120).nullish(),
})

const programSchema = z.object({
  code: z.string().trim().max(50).nullish(),
  name: z.string().trim().min(3, 'Название программы должно содержать не менее 3 символов').max(300),
})

const productSchema = z.object({
  name: z.string().trim().min(2, 'Название IT-продукта должно содержать не менее 2 символов').max(300),
})

export const externalImportSchema = z.object({
  /** Источник — часть ключа идемпотентности вместе с externalId. */
  source: z.enum(EXTERNAL_IMPORT_SOURCES),
  externalId: z.string().trim().min(1, 'Укажите внешний идентификатор').max(200),
  university: universitySchema,
  /** «ИТ-направление» ТЗ — образовательная программа вуза. */
  program: programSchema,
  product: productSchema,
  /**
   * Почты ответственных. Связка ведёт один ответственный (модель `Cooperation`) —
   * им становится первая почта, которая совпала с действующим ADMIN/MANAGER;
   * остальные адреса допустимы (несколько людей на стороне вуза/интеграции), но
   * ни на что не влияют.
   */
  responsibleEmails: z
    .array(z.string().trim().toLowerCase().email('Некорректная почта'))
    .min(1, 'Укажите хотя бы одну почту ответственного')
    .max(10),
})

export type ExternalImportInput = z.infer<typeof externalImportSchema>
