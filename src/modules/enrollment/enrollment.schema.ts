import { z } from '@/shared/zod'
import { paginationSchema } from '@/shared/http/pagination'

/** Загрузка заказов с сайта: по умолчанию предпросмотр, запись — только `mode=apply`. */
export const siteOrdersQuerySchema = z.object({
  mode: z.enum(['preview', 'apply']).default('preview'),
})

export type SiteOrdersQuery = z.infer<typeof siteOrdersQuerySchema>

/**
 * Файл «Загрузка пользователей» для LMS из того же файла заказов.
 *
 * `scope=new` (по умолчанию) — только слушатели, которых ещё не выгружали в LMS:
 * повторное нажатие не создаёт в LMS двойников. `scope=all` — все загруженные
 * заказы файла (если прошлый файл потерялся). Фильтр по курсу и потоку — потому что
 * в шаблоне LMS нет колонки курса: один файл — одна группа.
 */
export const lmsFileQuerySchema = z.object({
  scope: z.enum(['new', 'all']).default('new'),
  courseId: z.string().trim().min(1).max(100).optional(),
  stream: z.coerce.number().int().min(1).max(10_000).optional(),
})

export type LmsFileQuery = z.infer<typeof lmsFileQuerySchema>

export const schoolCourseListQuerySchema = paginationSchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
})

export type SchoolCourseListQuery = z.infer<typeof schoolCourseListQuerySchema>

export const createSchoolCourseSchema = z.object({
  name: z.string().trim().min(2, 'Название должно содержать не менее 2 символов').max(300),
  description: z.string().trim().max(2000).nullish(),
  /** Курс на базе IT-продукта — необязательно. */
  productId: z.string().trim().min(1).max(100).nullish(),
})

export type CreateSchoolCourseInput = z.infer<typeof createSchoolCourseSchema>
