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
