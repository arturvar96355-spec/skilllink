import type { StagePhase } from '@/shared/contracts/enums'

export interface TaskDefinition {
  title: string
  /** Обязательный пункт: пока не закрыт, этап нельзя перевести в COMPLETED. */
  isRequired: boolean
  /**
   * Пункт отмечается сам, когда подписаны документы связки (решение 87):
   * подпись уже зафиксирована в документе, вводить её второй раз не нужно.
   */
  closedBySignedDocuments?: boolean
}

export interface StageDefinition {
  number: number
  title: string
  phase: StagePhase
  /**
   * Нормативный срок этапа в днях от даты создания связки.
   * TEMP — значения взяты как рабочая гипотеза, утверждает Артур.
   * TODO: PM DECISION — согласовать нормативы по каждому этапу.
   */
  normativeDays: number
  /** Этап можно отменить как «не требуется» (решение 4 в CLAUDE.md). */
  optional: boolean
  tasks: TaskDefinition[]
}

/** Номер последнего этапа. Он вычисляется автоматически и вручную не меняется. */
export const CONTROL_STAGE_NUMBER = 14

/** Этап «Подписание документов»: его пункты отмечает подпись документов (решение 87). */
export const SIGNING_STAGE_NUMBER = 6

/**
 * Контрольные точки — этапы, которые нельзя начать и нельзя завершить, пока
 * не закрыто всё, что должно было случиться раньше.
 *
 * Порядок этапов в целом остаётся свободным (решение 5): в жизни они идут
 * параллельно. Но несколько этапов содержательно нельзя пройти раньше времени —
 * не потому, что так удобнее вести учёт, а потому, что иначе запись в системе
 * будет неправдой.
 *
 * Почему именно эти три:
 *
 * - **6, подписание документов.** Подпись раньше обмена документами юридически
 *   бессмысленна. Это единственный этап, где ошибка порядка создаёт не путаницу
 *   в учёте, а недействительный документ.
 * - **7, передача материалов и лицензии.** Передавать лицензию на продукт до
 *   подписания — это отдать продукт без договора. Отдельная точка от шестой:
 *   без неё материалы можно передать, пока подписание ещё идёт.
 * - **11, проведение занятий.** Занятия не могут начаться раньше, чем переданы
 *   материалы, развёрнут продукт, обучены преподаватели и обновлена программа.
 *   Отметка «занятия начались» при незакрытых 7–10 означает, что система
 *   показывает готовность, которой нет.
 *
 * Остальные этапы намеренно свободны: обучение преподавателей реально начинают
 * по предварительным материалам, программу обновляют параллельно с внедрением,
 * а этап 12 переоткрывается групповой операцией по выпуску версии — жёсткий
 * порядок там воевал бы с уже работающей возможностью.
 *
 * TODO: PM DECISION — состав контрольных точек подтверждает Артур (пункт 13).
 * Подтверждён 22.09.2026 без изменений: 6, 7, 11 (docs/DECISIONS.md, решение 13).
 */
export const CONTROL_POINT_STAGES: readonly number[] = [6, 7, 11] // TEMP

/**
 * 14 этапов из раздела 8 ТЗ. При создании связки создаются все сразу (решение 2).
 * Чек-листы — TEMP, состав пунктов утверждает Артур.
 * Сверен 22.09.2026: этап 8, «Проведена проверка работоспособности» стал обязательным,
 * остальное без изменений (docs/DECISIONS.md, решение 12).
 */
export const WORKFLOW_STAGES: readonly StageDefinition[] = [
  {
    number: 1,
    title: 'Поиск контакта ответственного лица в вузе',
    phase: 'ATTRACTION',
    normativeDays: 7,
    optional: false,
    tasks: [
      { title: 'Найден ответственный сотрудник вуза', isRequired: true }, // TEMP
      { title: 'Записаны рабочие контакты', isRequired: true }, // TEMP
      { title: 'Проверена актуальность контакта', isRequired: false }, // TEMP
    ],
  },
  {
    number: 2,
    title: 'Связь и подтверждение актуальности IT-программ',
    phase: 'ATTRACTION',
    normativeDays: 14,
    optional: false,
    tasks: [
      { title: 'Установлен первый контакт', isRequired: true }, // TEMP
      { title: 'Получено подтверждение актуальности программ', isRequired: true }, // TEMP
    ],
  },
  {
    number: 3,
    title: 'Организация встречи',
    phase: 'ATTRACTION',
    normativeDays: 21,
    optional: false,
    tasks: [
      { title: 'Согласована дата встречи', isRequired: true }, // TEMP
      { title: 'Встреча проведена и зафиксирован результат', isRequired: true }, // TEMP
    ],
  },
  {
    number: 4,
    title: 'Обмен документами',
    phase: 'FORMALIZATION',
    normativeDays: 35,
    optional: false,
    tasks: [
      { title: 'Пакет документов направлен в вуз', isRequired: true }, // TEMP
      { title: 'Получены документы от вуза', isRequired: true }, // TEMP
    ],
  },
  {
    number: 5,
    title: 'Доработка документов при необходимости',
    phase: 'FORMALIZATION',
    normativeDays: 49,
    optional: true,
    tasks: [
      { title: 'Собраны замечания сторон', isRequired: false }, // TEMP
      { title: 'Подготовлена исправленная редакция', isRequired: false }, // TEMP
    ],
  },
  {
    number: 6,
    title: 'Подписание документов',
    phase: 'FORMALIZATION',
    normativeDays: 63,
    optional: false,
    tasks: [
      { title: 'Документы подписаны со стороны вуза', isRequired: true, closedBySignedDocuments: true }, // TEMP
      { title: 'Документы подписаны со стороны ИТ-Школы', isRequired: true, closedBySignedDocuments: true }, // TEMP
      { title: 'Зафиксированы факт и дата подписания', isRequired: true, closedBySignedDocuments: true }, // TEMP
    ],
  },
  {
    number: 7,
    title: 'Передача учебных материалов, лицензии и документации',
    phase: 'IMPLEMENTATION',
    normativeDays: 77,
    optional: false,
    tasks: [
      { title: 'Переданы учебные материалы', isRequired: true }, // TEMP
      { title: 'Передана лицензия на IT-продукт', isRequired: true }, // TEMP
      { title: 'Вуз подтвердил получение материалов', isRequired: true }, // TEMP
    ],
  },
  {
    number: 8,
    title: 'Поддержка внедрения IT-продукта',
    phase: 'IMPLEMENTATION',
    normativeDays: 91,
    optional: false,
    tasks: [
      { title: 'Продукт развёрнут на стороне вуза', isRequired: true }, // TEMP
      { title: 'Проведена проверка работоспособности', isRequired: true }, // TEMP
    ],
  },
  {
    number: 9,
    title: 'Обучение преподавателей',
    phase: 'IMPLEMENTATION',
    normativeDays: 105,
    optional: false,
    tasks: [
      { title: 'Сформирована группа преподавателей', isRequired: true }, // TEMP
      { title: 'Обучение проведено', isRequired: true }, // TEMP
    ],
  },
  {
    number: 10,
    title: 'Обновление образовательной программы',
    phase: 'IMPLEMENTATION',
    normativeDays: 119,
    optional: false,
    tasks: [
      { title: 'Подготовлены изменения в программу', isRequired: true }, // TEMP
      { title: 'Изменения утверждены вузом', isRequired: true }, // TEMP
    ],
  },
  {
    number: 11,
    title: 'Проведение занятий',
    phase: 'OPERATION',
    normativeDays: 150,
    optional: false,
    tasks: [
      { title: 'Занятия начались', isRequired: true }, // TEMP
      { title: 'Внесены численность обучающихся и количество групп', isRequired: true }, // TEMP
    ],
  },
  {
    number: 12,
    title: 'Обновление документации и материалов',
    phase: 'OPERATION',
    normativeDays: 180,
    optional: false,
    tasks: [
      { title: 'Проверена актуальность версии материалов', isRequired: true }, // TEMP
      { title: 'Передана актуальная версия', isRequired: false }, // TEMP
    ],
  },
  {
    number: 13,
    title: 'Повышение квалификации преподавателей',
    phase: 'OPERATION',
    normativeDays: 210,
    optional: false,
    tasks: [
      { title: 'Согласован план повышения квалификации', isRequired: false }, // TEMP
      { title: 'Повышение квалификации проведено', isRequired: true }, // TEMP
    ],
  },
  {
    number: CONTROL_STAGE_NUMBER,
    title: 'Контроль выполнения всех этапов',
    phase: 'CONTROL',
    normativeDays: 240,
    optional: false,
    // Пунктов нет: этап вычисляется автоматически по состоянию этапов 1–13 (решение 2).
    tasks: [],
  },
]

export const STAGE_BY_NUMBER: ReadonlyMap<number, StageDefinition> = new Map(
  WORKFLOW_STAGES.map((stage) => [stage.number, stage]),
)

/** Реэкспорт: словарь подписей живёт в контрактах, доступных фронту. */
export { STAGE_PHASE_LABELS as PHASE_LABELS } from '@/shared/contracts/labels'
