import type { RecommendationStatus } from '@/shared/contracts'

/**
 * Какие рекомендации «открытые», а какие «закрытые» (решение 128). По умолчанию
 * лента показывает открытые: закрытая не должна вставать среди открытых
 * критичных только потому, что лента сортируется по важности.
 */
export const OPEN_RECOMMENDATION_STATUSES: RecommendationStatus[] = ['NEW', 'IN_PROGRESS']
export const CLOSED_RECOMMENDATION_STATUSES: RecommendationStatus[] = ['DONE', 'DISMISSED']
