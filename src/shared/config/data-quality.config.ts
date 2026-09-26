/**
 * Качество справочника, поиск дублей, похожие программы (решение 134).
 * Формулы — docs/ANALYTICS_METHODOLOGY.md, раздел 8, и TECHNICAL_DECISIONS.md, решение 134.
 * Все числа — рабочие значения (TEMP): согласуются с заказчиком.
 */

export const DUPLICATES = {
  /**
   * Порог сходства по триграммам по умолчанию — как `pg_trgm.similarity_threshold`.
   * Запрос может передать свой (`threshold`).
   */
  trigramThreshold: 0.4, // TEMP
  /**
   * Левенштейн — только для коротких строк: на длинных триграммы точнее,
   * а у коротких («Pyhton» — «Python») триграмм слишком мало. Длина — нормализованной строки.
   */
  levenshtein: {
    minLength: 4, // TEMP
    maxLength: 12, // TEMP
    /** Допустимое число правок: до 6 знаков — одна, длиннее — две. */
    maxEditsShort: 1, // TEMP
    maxEditsLong: 2, // TEMP
    shortUpTo: 6, // TEMP
  },
  /** Совпадение по словарю сокращений и синонимов — почти наверняка дубль. */
  synonymScore: 0.95, // TEMP
  /** Аббревиатура одного названия совпала с сокращённым названием другого. */
  abbreviationScore: 0.9, // TEMP
  /** Вузы: разные города — множитель сходства (филиал или тёзка, а не дубль). */
  differentCityFactor: 0.8, // TEMP
  /** Программы: разный уровень (бакалавриат и магистратура) — множитель. */
  differentLevelFactor: 0.8, // TEMP
  /**
   * Вузы: разное «имени …» у одинаковой значимой части (тёзки в одном городе) — множитель.
   * Считается разным, если сходство по триграммам ниже порога.
   */
  differentHonorificFactor: 0.5, // TEMP
  differentHonorificBelow: 0.3, // TEMP
  /**
   * Сколько записей сущности сравнивается «все со всеми» в приложении. Больше —
   * кандидаты отбирает база оператором `%` по GIN-индексу (pg_trgm), приложение
   * досчитывает только их.
   */
  allPairsLimit: 1500, // TEMP
  /** Больше пар в одном ответе не отдаётся — сначала самые похожие. */
  maxPairs: 200, // TEMP
} as const

/**
 * Оценка качества справочника 0–100. По каждой сущности:
 *   score = 100 × (1 − Σ weight_i × доля_i),
 * где доля_i — часть записей с проблемой i, Σ weight_i = 1. Итоговая — среднее
 * оценок сущностей с весами ENTITY_WEIGHTS (сущность без записей не учитывается).
 */
export const QUALITY = {
  entityWeights: {
    university: 0.25, // TEMP
    program: 0.3, // TEMP
    skill: 0.2, // TEMP
    product: 0.1, // TEMP
    cooperation: 0.15, // TEMP
  },
  issueWeights: {
    university: { noContacts: 0.4, noPrograms: 0.3, duplicates: 0.3 }, // TEMP
    program: { noSkills: 0.5, stale: 0.25, duplicates: 0.25 }, // TEMP
    skill: { demandWithoutPrograms: 0.3, unused: 0.3, duplicates: 0.4 }, // TEMP
    product: { noSkills: 0.7, duplicates: 0.3 }, // TEMP
    cooperation: { noResponsible: 0.4, noMeetings: 0.6 }, // TEMP
  },
  /** Программа без обновлений дольше — устарела. */
  programStaleDays: 180, // TEMP
  /** Открытая связка без встреч дольше — «заброшена». */
  cooperationNoMeetingDays: 60, // TEMP
  /** Сколько записей-примеров показывать в каждой проблеме. */
  sampleLimit: 10, // TEMP
} as const

/**
 * Похожие программы: косинус векторов навыков (вес навыка = важность × idf)
 * плюс бонусы. score = (1 − Σ бонусов) × cos + бонус за направление + бонус за уровень.
 */
export const SIMILAR_PROGRAMS = {
  importanceWeights: {
    LOW: 0.25, // TEMP
    MEDIUM: 0.5, // TEMP
    HIGH: 0.75, // TEMP
    CRITICAL: 1, // TEMP
  },
  /** Та же укрупнённая группа направлений (первые две цифры кода) или то же направление. */
  directionBonus: 0.1, // TEMP
  levelBonus: 0.05, // TEMP
  defaultLimit: 5, // TEMP
  maxLimit: 20,
  /** Сколько «чего не хватает» показывать. */
  missingLimit: 10, // TEMP
} as const

/** Слияние вузов: сколько дней после слияния его можно отменить. */
export const UNIVERSITY_MERGE = {
  undoDays: 30, // TEMP
} as const

/** Лента 360 вуза: размер страницы. */
export const TIMELINE = {
  defaultLimit: 20,
  maxLimit: 100,
} as const

/** Тепловая карта встреч: часовой пояс отображения. */
export const MEETINGS_HEATMAP = {
  timeZone: 'Europe/Moscow',
} as const
