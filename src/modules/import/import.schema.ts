import { z } from '@/shared/zod'

export const IMPORT_DATASETS = ['universities', 'programs'] as const

export const importQuerySchema = z.object({
  dataset: z.enum(IMPORT_DATASETS),
  /**
   * По умолчанию — предпросмотр. Импорт, который пишет в базу с первого запроса,
   * слишком легко запустить случайно: сначала человек смотрит, что получится.
   */
  mode: z.enum(['preview', 'apply']).default('preview'),
})

export type ImportQuery = z.infer<typeof importQuerySchema>

/** Колонки файлов. Совпадают с заголовками выгрузки, чтобы цикл выгрузка → правка → загрузка работал. */
export const UNIVERSITY_COLUMNS = {
  required: ['Название', 'Город', 'Регион'],
  optional: ['Краткое название', 'Направлений', 'Студентов', 'Сайт'],
} as const

export const PROGRAM_COLUMNS = {
  required: ['Вуз', 'Программа', 'Уровень'],
  optional: ['Код', 'Направление', 'Длительность, мес.', 'Заявки', 'Обучающихся', 'Групп'],
} as const
