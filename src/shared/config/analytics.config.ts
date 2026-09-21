/**
 * Все коэффициенты аналитики. Формулы описаны в docs/ANALYTICS_METHODOLOGY.md.
 * Любое число отсюда помечено TEMP: утверждает Артур, пока это рабочая гипотеза.
 * TODO: PM DECISION — утвердить веса рейтинга и пороги дефицита навыков.
 */

/**
 * Рейтинг образовательной программы считается ровно по трём показателям ТЗ (решение 7).
 * Востребованность навыков, skill gap и готовность вуза в рейтинг не входят —
 * они показываются отдельными объяснимыми сигналами.
 */
export const PROGRAM_RATING_WEIGHTS = {
  applicationCount: 0.4, // TEMP
  studentCount: 0.4, // TEMP
  groupCount: 0.2, // TEMP
} as const

export type ProgramRatingFactor = keyof typeof PROGRAM_RATING_WEIGHTS

export const PROGRAM_RATING_LABELS: Record<ProgramRatingFactor, string> = {
  applicationCount: 'Заявки на обучение',
  studentCount: 'Количество обучающихся',
  groupCount: 'Количество параллельных групп',
}

/** Минимальная доля заполненных показателей, при которой рейтинг вообще считается. */
export const RATING_MIN_FILLED_FACTORS = 1 // TEMP

/** Итоговый балл рейтинга приводится к этой шкале. */
export const RATING_SCALE = 100 // TEMP

/**
 * Пороги дефицита навыка (skill gap).
 * Спрос нормируется к 0..1 внутри рассматриваемого периода.
 */
export const SKILL_GAP = {
  /** Навык считается востребованным, если нормированный спрос не ниже порога. */
  demandThreshold: 0.5, // TEMP
  /** Дефицит критичен, если навык востребован и полностью отсутствует в программе. */
  criticalWhenMissing: true,
  /** Вклад уровня освоения в покрытие навыка программой. */
  levelCoverage: {
    BASIC: 0.34, // TEMP
    INTERMEDIATE: 0.67, // TEMP
    ADVANCED: 1, // TEMP
  },
} as const

/** Вес важности навыка для направления при расчёте соответствия программы рынку. */
export const IMPORTANCE_WEIGHTS = {
  LOW: 0.25, // TEMP
  MEDIUM: 0.5, // TEMP
  HIGH: 0.75, // TEMP
  CRITICAL: 1, // TEMP
} as const

/** Сколько дней до дедлайна этап считается «скоро просрочится». */
export const DEADLINE_WARNING_DAYS = 3 // TEMP

/** Период по умолчанию для рыночных данных, если запрос его не задал. */
export const DEFAULT_MARKET_PERIOD = '2026-Q1' // TEMP

/** Сколько записей отдаётся в блоках дашборда «топ» и «проблемные». */
export const DASHBOARD_TOP_LIMIT = 5 // TEMP

/**
 * Пороги правил генерации рекомендаций.
 * Рекомендация не заменяет решение сотрудника (раздел 4 ТЗ) — она только объясняет,
 * почему система считает действие нужным.
 */
export const RECOMMENDATION_RULES = {
  /** Просрочка этапа: со скольких дней приоритет поднимается. */
  overdueHighDays: 7, // TEMP
  overdueCriticalDays: 21, // TEMP
  /** Сколько дней связка может стоять с неначатым текущим этапом, прежде чем это отмечается. */
  stalledDays: 14, // TEMP
  /** С какого этапа отсутствие выбранного IT-продукта становится проблемой. */
  productRequiredFromStage: 4, // TEMP
  /** Сколько критичных дефицитов показывать рекомендациями за раз. */
  criticalGapLimit: 10, // TEMP
} as const
