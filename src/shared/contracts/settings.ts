import type { StagePhase } from './enums'

/**
 * «Настройки → Параметры расчётов» (решение 107): текущие значения коэффициентов,
 * порогов и нормативов — ровно те, с которыми сейчас считает код. Только чтение:
 * значения меняются правкой конфигурации в `src/shared/config`, а не в интерфейсе.
 */

/**
 * В чём измеряется значение — фронту, чтобы подписать число:
 * `weight` — вес в формуле (0,4), `share` — доля 0..1 (порог 0,5 → «50 из 100»),
 * `days`, `minutes`, `count`, `points` — баллы шкалы, `stage` — номер этапа,
 * `flag` — да/нет, `list` — перечень, `choice` — вариант с подписью в `valueLabel`.
 */
export type ParameterUnit =
  | 'weight'
  | 'share'
  | 'days'
  | 'minutes'
  | 'count'
  | 'points'
  | 'stage'
  | 'flag'
  | 'list'
  | 'choice'

export interface CalculationParameterDto {
  /**
   * Где значение живёт в коде: `SKILL_GAP.levelCoverage.BASIC`. Постоянный ключ
   * строки — годится в `key` списка; по нему же тест сверяет значение с конфигом.
   */
  configKey: string
  /** Подпись по-русски. */
  label: string
  /** Коротко: на что влияет. */
  hint: string | null
  value: number | boolean | string | readonly number[] | readonly string[]
  unit: ParameterUnit
  /** Для `choice` — значение словами («среднее по программам»), иначе null. */
  valueLabel: string | null
  /**
   * Рабочее значение, утверждается с заказчиком: в коде помечено `// TEMP`.
   * Фронт показывает пометку рядом со значением.
   */
  isTemporary: boolean
}

/** Где описано, как значение используется. Документы лежат в репозитории (`docs/`). */
export interface MethodologyRefDto {
  /** Путь от корня репозитория: `docs/ANALYTICS_METHODOLOGY.md`. */
  document: string
  /** Заголовок раздела в документе — как он написан. */
  section: string
}

export type CalculationParameterGroupId =
  | 'programRating'
  | 'skillGap'
  | 'skillProfile'
  | 'workflow'
  | 'recommendations'
  | 'recommendationLearning'
  | 'login'
  | 'retention'

export interface CalculationParameterGroupDto {
  id: CalculationParameterGroupId
  title: string
  description: string
  methodology: MethodologyRefDto
  parameters: CalculationParameterDto[]
}

/** Норматив одного из 14 этапов (раздел 8 ТЗ, `WORKFLOW_STAGES`). */
export interface StageNormDto {
  number: number
  title: string
  phase: StagePhase
  phaseLabel: string
  /** Нормативный срок в днях от даты создания связки. */
  normativeDays: number
  /** Контрольная точка: этап нельзя начать и завершить, пока не закрыто прежнее. */
  isControlPoint: boolean
  /** Этап можно отменить как «не требуется». */
  isOptional: boolean
  /** Этап вычисляется сам по этапам 1–13 и вручную не меняется (этап 14). */
  isAutomatic: boolean
  /** Сколько в чек-листе обязательных пунктов и всего. */
  requiredTaskCount: number
  taskCount: number
  /** Нормативный срок — рабочее значение (TEMP), утверждается с заказчиком. */
  isTemporary: boolean
}

export interface CalculationParametersDto {
  groups: CalculationParameterGroupDto[]
  /** Нормативы этапов — таблицей; методика — в группе `workflow`. */
  stages: StageNormDto[]
  /** Сколько значений рабочие (TEMP) — для строки «N значений ждут утверждения». */
  temporaryCount: number
}
