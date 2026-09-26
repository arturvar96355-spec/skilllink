import type { RecommendationScoreDto } from '@/shared/contracts'
import type { ScorePart } from '@/ui'

/**
 * Разбор балла рекомендации на вклады факторов (решение 119, п. 3 решения 178):
 * `score = weights.rule·p + weights.value·valueScore + weights.priority·priority`.
 * Чистая функция, вынесена из `RecommendationScore.tsx` отдельно от JSX — так
 * её можно проверить тестом без рендера компонента.
 */
export function partsOf(breakdown: RecommendationScoreDto): ScorePart[] {
  return [
    { key: 'rule', title: 'Вес правила', contribution: breakdown.weights.rule * breakdown.p * 100, value: breakdown.p },
    {
      key: 'value',
      title: 'Ценность случая',
      contribution: breakdown.weights.value * breakdown.valueScore * 100,
      value: breakdown.value,
    },
    {
      key: 'priority',
      title: 'Приоритет',
      contribution: breakdown.weights.priority * breakdown.priority * 100,
      value: breakdown.priority,
    },
  ]
}
