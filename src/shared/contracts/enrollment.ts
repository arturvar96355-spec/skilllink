/**
 * Набор на курсы ИТ-Школы: заказы с сайта, курсы, потоки, показатели набора (решение 132).
 *
 * Персональных данных слушателей в этих DTO нет и быть не должно: ни ФИО, ни почты,
 * ни телефона. Они проходят через запрос загрузки и уходят только в файл для LMS.
 */

/** Замечание к строке загрузки: где (строка, колонка) и что. Значение ячейки не повторяется. */
export interface ImportIssueDto {
  /** Строка файла (для xlsx/CSV — с заголовком первой) или номер элемента массива JSON. */
  row: number
  column: string
  message: string
}

/** Отчёт о качестве данных файла заказов: что система поправила и что нашла. */
export interface SiteOrdersQualityDto {
  /** Элементов массива всего, включая пустые. */
  totalItems: number
  /** Пустые элементы (`null`, объект без значений) — пропущены. */
  emptyItemsSkipped: number
  /** Принято строк (без ошибок). */
  validRows: number
  /** Строк с ошибками — не загружаются. */
  rowsWithErrors: number
  /** Телефонов, приведённых к виду 7XXXXXXXXXX. */
  phonesNormalized: number
  /** Почт, приведённых к нижнему регистру. */
  emailsLowercased: number
  /** Строк, где в ФИО убраны пробелы или поднята первая буква. */
  namesFixed: number
  /** Номеров заявок с несуществующей датой (месяц 17, секунды 69, 15 цифр). */
  brokenOrderNumbers: number
  /** Повторы номера заявки внутри файла. */
  duplicateOrderNumbersInFile: number
  /** Повторные заявки того же слушателя на тот же курс и поток внутри файла. */
  duplicateListenersInFile: number
  /** Заказы, уже загруженные раньше (по номеру заявки) — повторно не создаются. */
  alreadyImported: number
  /** Слушатели, которые уже были в прошлых загрузках (совпал HMAC почты или телефона). */
  knownListeners: number
  /** Курсы из файла, которых нет в системе: заказы по ним не загружаются. */
  unknownCourses: Array<{ name: string; rows: number }>
  /** Потоки, которые будут заведены (или заведены) этой загрузкой. */
  newStreams: Array<{ courseName: string; number: number }>
}

/** Сколько заказов приходится на курс и поток в этой загрузке. */
export interface SiteOrdersCourseSummaryDto {
  courseId: string
  courseName: string
  streamNumber: number | null
  orders: number
}

/** Ответ загрузки заказов: `preview` ничего не пишет, `apply` записывает. */
export interface SiteOrdersImportResultDto {
  mode: 'preview' | 'apply'
  /** Номер загрузки — только у `apply` и только если что-то записано. */
  batchId: string | null
  /** Заказов к созданию (preview) или созданных (apply). */
  toCreate: number
  errors: ImportIssueDto[]
  warnings: ImportIssueDto[]
  quality: SiteOrdersQualityDto
  courses: SiteOrdersCourseSummaryDto[]
  processedAt: string
}

/** Поток курса с показателями набора. */
export interface CourseStreamDto {
  id: string
  number: number
  startsAt: string | null
  /** Заявки (заказы с сайта) на поток. */
  orderCount: number
  /** Разные люди среди заказов потока: совпадение почты или телефона — один человек. */
  listenerCount: number
}

/** Курс ИТ-Школы с показателями набора: «заявки, студенты, группы» (раздел 7.4 ТЗ). */
export interface SchoolCourseDto {
  id: string
  name: string
  description: string | null
  /** Курс «на базе продукта» — продукт и его вендор. */
  product: { id: string; name: string; vendorId: string | null; vendorName: string | null } | null
  orderCount: number
  listenerCount: number
  /** Групп (потоков) с заказами или заведённых. */
  streamCount: number
  streams: CourseStreamDto[]
  /** Дата последнего заказа по номеру заявки; null — нет заказов или все даты битые. */
  lastOrderAt: string | null
  isMock: boolean
}

/** Итог по всем курсам — в `meta` списка курсов. */
export interface SchoolCoursesTotalsDto {
  orderCount: number
  /** Разные люди по всем курсам: человек на двух курсах — один слушатель. */
  listenerCount: number
  streamCount: number
}
