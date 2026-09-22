import { z } from 'zod'

/**
 * Одна буква находит почти всё и ничего не говорит — поиск начинается с двух.
 * Ограничение на группу маленькое: окно поиска показывает первые совпадения,
 * а за полным списком человек идёт в раздел.
 */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Введите хотя бы два символа').max(100),
  limit: z.coerce.number().int().min(1).max(10).default(5),
})

export type SearchQuery = z.infer<typeof searchQuerySchema>
