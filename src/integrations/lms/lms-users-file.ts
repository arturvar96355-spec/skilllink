import { writeXlsx, type XlsxCellValue } from '@/shared/files/xlsx'

/**
 * Файл «Загрузка пользователей» для LMS (решение 132).
 *
 * Воспроизводит шаблон LMS, который дали организаторы: те же 30 заголовков
 * на «Лист1» — байт в байт, с опечатками шаблона («Отчествопри наличии)»,
 * «Имядательный падеж)»: пропущено « (»), — и справочники на «Лист2» (пол,
 * уровни образования), на которые ссылаются списки в колонках «Пол» и «Образование».
 * Исправлять заголовки нельзя: загрузчик LMS, скорее всего, сверяет их буквально.
 *
 * Заполняются только Фамилия, Имя, Отчество, Номер телефона, Email. СНИЛС, паспорт,
 * адрес регистрации, дата рождения, пол, диплом — пустые: SkillLink их не собирает
 * и не хранит (docs/PRIVACY.md, раздел о заказах с сайта). Их вносит слушатель или
 * методист уже в LMS — там, где у оператора есть на это основание и защита.
 */

/** Заголовки «Лист1» — в порядке и написании шаблона. */
export const LMS_USER_COLUMNS = [
  'Фамилия',
  'Имя',
  'Отчествопри наличии)',
  'Номер телефона',
  'Email',
  'СНИЛС',
  'Серия паспорта',
  'Номер паспорта',
  'Кем выдан паспорт',
  'Дата выдачи паспорта',
  'Код подразделения',
  'Пол',
  'Дата рождения',
  'Регион регистрации',
  'Населенный пункт регистрации',
  'Улица регистрации',
  'Дом регистрации',
  'Квартира регистрации',
  'Индекс регистрации',
  'Имядательный падеж)',
  'Фамилиядательный падеж)',
  'Отчестводательный падеж)',
  'Образование',
  'Профессия по диплому',
  'Учебное заведение по диплому',
  'Фамилия, указанная в дипломе',
  'Номер диплома',
  'Серия диплома',
  'Регистрационный номер диплома',
  'Дата выдачи диплома',
] as const

/** «Лист2», колонка A: список для колонки «Пол» (L). */
export const LMS_GENDERS = ['М', 'Ж'] as const

/**
 * «Лист2», колонка B: список для колонки «Образование» (W). Тире — как в шаблоне:
 * в двух первых пунктах дефис-минус, в трёх последних — короткое тире (U+2013).
 */
export const LMS_EDUCATION_LEVELS = [
  'Без образования',
  'Основное общее образование - 9 классов',
  'Среднее общее образование - 11 классов',
  'Среднее профессиональное образование',
  'Высшее образование – бакалавриат',
  'Высшее образование – специалитет, магистратура',
  'Высшее образование – подготовка кадров высшей квалификации',
] as const

/** Ширина колонок «Лист1» — как в шаблоне, чтобы файл открывался привычно. */
const COLUMN_WIDTHS = [
  23.9, 24.9, 24, 22.1, 20.7, 14.7, 14.6, 15.9, 19.6, 20.4, 18.4, 8.6, 15.3, 18.1, 29.1, 17.7, 16.3, 20.3, 19, 23,
  27, 26.1, 37.1, 21.4, 29.6, 29, 15.3, 14.9, 31, 22,
]

/** Одна строка файла: только то, что есть в заказе с сайта. */
export interface LmsUserRow {
  lastName: string
  firstName: string
  middleName: string | null
  /** 11 цифр, первая 7: в шаблоне номер записан числом 79990234365. */
  phoneDigits: string | null
  email: string
}

/** Номер телефона числом, как в шаблоне: 11 цифр укладываются в точность Excel без потерь. */
function phoneCell(digits: string | null): XlsxCellValue {
  if (!digits) return null
  const value = Number(digits)
  return Number.isSafeInteger(value) ? value : digits
}

/** Собирает файл «Загрузка пользователей». Пустой список — файл только с заголовками. */
export function buildLmsUsersFile(rows: readonly LmsUserRow[], now: Date = new Date()): Buffer {
  const width = LMS_USER_COLUMNS.length
  const sheet1: XlsxCellValue[][] = [
    [...LMS_USER_COLUMNS],
    ...rows.map((row) => {
      const cells: XlsxCellValue[] = new Array<XlsxCellValue>(width).fill(null)
      cells[0] = row.lastName
      cells[1] = row.firstName
      cells[2] = row.middleName
      cells[3] = phoneCell(row.phoneDigits)
      cells[4] = row.email
      return cells
    }),
  ]

  const dictionaryRows = Math.max(LMS_GENDERS.length, LMS_EDUCATION_LEVELS.length)
  const sheet2: XlsxCellValue[][] = Array.from({ length: dictionaryRows }, (_, i) => [
    LMS_GENDERS[i] ?? null,
    LMS_EDUCATION_LEVELS[i] ?? null,
  ])

  return writeXlsx(
    [
      {
        name: 'Лист1',
        rows: sheet1,
        boldHeader: true,
        columnWidths: COLUMN_WIDTHS,
        // Те же списки, что в шаблоне: «Пол» (L) и «Образование» (W) — из «Лист2».
        validations: [
          { sqref: 'L1:L1001', listSource: `Лист2!$A$1:$A$${LMS_GENDERS.length}` },
          { sqref: 'W1:W1001', listSource: `Лист2!$B$1:$B$${LMS_EDUCATION_LEVELS.length}` },
        ],
      },
      { name: 'Лист2', rows: sheet2, columnWidths: [11.6, 58.1] },
    ],
    now,
  )
}
