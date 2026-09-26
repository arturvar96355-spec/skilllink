import { dateBoundarySchema, z } from '@/shared/zod'
import { COOPERATION_STATUSES } from '@/shared/contracts/enums'

/**
 * Форматы отчётов «по ТЗ» и «Каталог по ТЗ» (решение 145, ТЗ требования к решению п.4
 * и функц. требования: результирующий json-файл и форматы отчётов).
 *
 * `pdf` из ТЗ здесь не эндпоинт: это печать листа браузером («Печать / PDF»,
 * см. `/reports/portfolio` — тот же принцип для «Отчёта руководителю»), а не файл,
 * который формирует сервер.
 */
export const REPORT_FORMATS = ['csv', 'xlsx', 'json'] as const
export type ReportFormat = (typeof REPORT_FORMATS)[number]

/**
 * Фильтры отчётов «по ТЗ» и «Каталог по ТЗ» (решение 172): ТЗ заказчика требует, чтобы
 * оба отчёта формировались «с фильтрами по периоду, вузу, ИТ-направлению (программе),
 * ИТ-продукту и ответственному» — все фильтры необязательны, работают вместе с `format`.
 *
 * Период — по активности связки, а не по дате её создания: связка попадает в отчёт,
 * если к концу периода она уже существовала и не была закрыта до его начала —
 * то есть была действующей хотя бы день внутри периода, а не только заведена в нём.
 * Так период отвечает на реальный вопрос отчёта («что происходило в первом квартале»),
 * а не выбрасывает связки, заведённые раньше и работающие до сих пор.
 */
export const reportQuerySchema = z
  .object({
    format: z.enum(REPORT_FORMATS).default('csv'),
    dateFrom: dateBoundarySchema('start').optional(),
    dateTo: dateBoundarySchema('end').optional(),
    universityId: z.string().trim().min(1).optional(),
    programId: z.string().trim().min(1).optional(),
    productId: z.string().trim().min(1).optional(),
    responsibleId: z.string().trim().min(1).optional(),
    status: z.enum(COOPERATION_STATUSES).optional(),
  })
  .refine((value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, {
    message: 'Начало периода не может быть позже его конца',
    path: ['dateFrom'],
  })

export type ReportQuery = z.infer<typeof reportQuerySchema>

/** Фильтры без формата — то, что уходит в репозиторий и в имя/шапку файла. */
export type ReportFilters = Omit<ReportQuery, 'format'>
