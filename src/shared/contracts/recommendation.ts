import type {
  ConfidenceLevel,
  RecommendationPriority,
  RecommendationStatus,
  RecommendationType,
} from './enums'

/**
 * Сортировка ленты «сначала самые важные» — значение параметра `sort`.
 *
 * Приоритет в базе — перечисление LOW < MEDIUM < HIGH < CRITICAL, поэтому
 * `sort=priority` (по возрастанию) ставит сверху наименее важное: первой пойдёт
 * «Связка без движения» средней важности, а критичные просрочки — в самом низу.
 */
export const RECOMMENDATION_SORT_MOST_IMPORTANT = '-priority'

/**
 * Сортировка ленты по баллу (решение 119): сверху то, что с наибольшей
 * вероятностью окажется полезным, — с учётом решений сотрудников по правилу,
 * ценности случая и приоритета. Отложенные защитой от перегрузки — в конце.
 */
export const RECOMMENDATION_SORT_BY_SCORE = '-score'

/**
 * Куда можно перевести рекомендацию из текущего статуса. Одна таблица на сервер
 * и интерфейс: сервер отвечает INVALID_TRANSITION на всё, чего здесь нет,
 * интерфейс показывает только эти кнопки.
 *
 * Закрытая (`DONE`) руками не переоткрывается: если проблема вернулась,
 * её снова откроет пересборка. Отклонённую можно вернуть в новые.
 *
 * Закрыть рекомендацию, чьё условие проверяется по данным (просрочка, застой,
 * продукт не выбран, нет показателей), можно только когда условие ушло, —
 * это проверяет сервер отдельно от таблицы (CONFLICT).
 */
export const RECOMMENDATION_TRANSITIONS: Record<RecommendationStatus, readonly RecommendationStatus[]> = {
  // Четыре статуса (решение 98): Новая → В работе → Выполнена / Отклонена.
  NEW: ['IN_PROGRESS', 'DISMISSED'],
  IN_PROGRESS: ['DONE', 'DISMISSED'],
  // «Принята» упразднена; миграция перевела такие записи «В работу». Выход оставлен
  // на случай записи, пришедшей из старой копии базы, — войти в статус нельзя.
  ACCEPTED: ['IN_PROGRESS', 'DONE', 'DISMISSED'],
  DISMISSED: ['NEW'],
  DONE: [],
}

/** Ссылка на объект, к которому относится рекомендация. */
export interface RecommendationTargetDto {
  objectType: 'Cooperation' | 'EducationalProgram' | 'University' | 'Skill'
  objectId: string
  /** Человекочитаемое имя объекта для ссылки на фронте. */
  label: string
}

export interface RecommendationDto {
  id: string
  type: RecommendationType
  /** Ключ правила, породившего рекомендацию. Нужен фронту для группировки. */
  ruleKey: string
  title: string
  description: string
  priority: RecommendationPriority
  /** Почему система это предлагает. Показывается пользователю всегда. */
  justification: string
  /** Данные, на которых основано предложение: их можно раскрыть в карточке. */
  relatedData: Record<string, unknown> | null
  confidence: ConfidenceLevel
  status: RecommendationStatus
  /** Комментарий сотрудника при закрытии или отклонении. */
  resolutionComment: string | null
  target: RecommendationTargetDto
  cooperationId: string | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  /**
   * Решение 119. Балл 0..1 — по нему сортирует `sort=-score`. null — запись
   * ещё не пересчитывалась (создана до обучения рекомендаций).
   */
  score: number | null
  /** Разбор балла: почему эта рекомендация выше другой. */
  scoreBreakdown: RecommendationScoreDto | null
  /** Почему система это предлагает — проверками правила и пометками обучения. */
  reasons: RecommendationReasonDto[]
  /** Отложена защитой от перегрузки: у менеджера много невыполненных, а балл ниже порога. */
  isDeferred: boolean
}

/** Уровень статистики правила. */
export type RuleStatsScopeType = 'global' | 'university' | 'manager'

/**
 * Разбор балла рекомендации (решение 119):
 * `score = weights.rule·p + weights.value·valueScore + weights.priority·priority`.
 */
export interface RecommendationScoreDto {
  /** Вероятность, что рекомендация этого правила окажется полезной (0..1). */
  p: number
  /**
   * Откуда оценка: `global` — по всем (своих данных нет), `pooled` — свои данные есть,
   * но их мало и они смешаны с общей оценкой, `local` — своих данных достаточно.
   */
  pSource: 'local' | 'pooled' | 'global'
  /** Чьи счётчики показаны: общий уровень, вуз или менеджер. */
  pLevel: RuleStatsScopeType
  /** `mean` — среднее (по умолчанию), `thompson` — случайная выборка. */
  sampling: 'mean' | 'thompson'
  /** Эффективные (с затуханием) показы и успехи уровня `pLevel`. */
  trialsEff: number
  successesEff: number
  /** Ценность случая: число и что оно значит («дней просрочки»). */
  value: number
  valueLabel: string
  valueAnchor: number
  /** Насыщенная ценность v / (v + якорь), 0..1. */
  valueScore: number
  /** Приоритет в долях: критичный 1, высокий 0,67, средний 0,33, низкий 0. */
  priority: number
  weights: { rule: number; value: number; priority: number }
  score: number
}

/**
 * Причина рекомендации или проверка «почему её нет». Код — `<предмет>_<состояние>`
 * (`cooperation_stalled`, `demand_above_threshold`, `dismissed_recently`), текст —
 * из единого словаря по фактам.
 */
export interface RecommendationReasonDto {
  code: string
  /** Проверка пройдена — довод «за»; не пройдена — довод «против». */
  pass: boolean
  /** Короткое название проверки. */
  label: string
  /** Текст из фактов: «Связка без движения 21 дн. при пороге 14». */
  detail: string
  facts: Record<string, unknown>
}

/** Одна проверка ответа «почему нет рекомендации». */
export interface WhyNotCheckDto {
  ruleKey: string
  check: string
  pass: boolean
  label: string
  detail: string
  facts: Record<string, unknown>
}

export interface WhyNotRuleDto {
  ruleKey: string
  ruleLabel: string
  /** Все проверки пройдены — правило выдаёт рекомендацию. */
  wouldRecommend: boolean
  checks: WhyNotCheckDto[]
  /** Уже существующая запись по этому правилу и объекту. */
  recommendation: { id: string; status: RecommendationStatus; isDeferred: boolean } | null
}

export type WhyNotEntity = 'program' | 'cooperation' | 'skill'

/** `GET /api/recommendations/why-not` — те же проверки, что у правила при пересборке. */
export interface WhyNotDto {
  entity: WhyNotEntity
  id: string
  label: string
  rules: WhyNotRuleDto[]
  /** Все проверки всех правил подряд — для простого списка. */
  checks: WhyNotCheckDto[]
  checkedAt: string
}

/** Вес правила на одном уровне статистики. */
export interface RuleWeightDto {
  scopeType: RuleStatsScopeType
  scopeId: string
  /** Название вуза; для менеджера и общего уровня — null. */
  scopeLabel: string | null
  /** Вероятность полезности (среднее Beta) на сегодня, с пулингом к уровню выше. */
  p: number
  pSource: 'local' | 'pooled' | 'global'
  /** 90-процентный интервал Beta: [5 %, 95 %]. */
  ci90: [number, number]
  trials: number
  successes: number
  trialsEff: number
  successesEff: number
  /** Последнее событие; null — событий не было. */
  updatedAt: string | null
}

export interface RuleStatsDto extends RuleWeightDto {
  ruleKey: string
  ruleLabel: string
  enabled: boolean
  /** Уровни вузов и менеджеров с данными. */
  scopes: RuleWeightDto[]
}

/** `GET /api/recommendations/rules/stats`. */
export interface RuleStatsListDto {
  rules: RuleStatsDto[]
  halfLifeDays: number
  poolingStrength: number
  sampling: 'mean' | 'thompson'
  /**
   * В базе демо-набор: история решений в нём смоделирована при заливке (решение 119),
   * это не реальная статистика — фронт обязан это показать.
   */
  isMock: boolean
  computedAt: string
}

export interface RecommendationGenerationResultDto {
  created: number
  updated: number
  /** Рекомендации, которые перестали быть актуальными и были закрыты. */
  closed: number
  total: number
  generatedAt: string
}
