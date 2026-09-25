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
 * `sort=priority` (по возрастанию) ставит сверху наименее важное. До 23.09.2026
 * лента и вкладка карточки связки запрашивали именно так: первой шла
 * «Связка без движения» средней важности, а три критичные просрочки — в самом низу.
 */
export const RECOMMENDATION_SORT_MOST_IMPORTANT = '-priority'

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
}

export interface RecommendationGenerationResultDto {
  created: number
  updated: number
  /** Рекомендации, которые перестали быть актуальными и были закрыты. */
  closed: number
  total: number
  generatedAt: string
}
