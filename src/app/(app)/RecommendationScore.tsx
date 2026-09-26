import type { RecommendationScoreDto } from '@/shared/contracts'
import { ScoreBar, ScoreLegend, formatNumber, formatShare, type ScorePart } from '@/ui'
import styles from './RecommendationScore.module.css'

/**
 * «Как посчитан балл» (решение 119, п. 3 решения 178): полоски вкладов —
 * вес правила по решениям сотрудников, ценность случая и приоритет —
 * той же полосой, что рейтинг программы (`ScoreBar`), только с другими
 * тремя факторами. `score = weights.rule·p + weights.value·valueScore + weights.priority·priority`.
 */

const LEGEND_ITEMS = [
  { key: 'rule', title: 'Вес правила' },
  { key: 'value', title: 'Ценность случая' },
  { key: 'priority', title: 'Приоритет' },
]

const SOURCE_LABEL: Record<RecommendationScoreDto['pSource'], string> = {
  local: 'по своим решениям',
  pooled: 'мало своих решений',
  global: 'общая оценка',
}

function partsOf(breakdown: RecommendationScoreDto): ScorePart[] {
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

export interface RecommendationScoreProps {
  score: number | null
  breakdown: RecommendationScoreDto | null
  /** `full` — с легендой и разбором по фактору (панель); `compact` — только полоска и число (строка списка). */
  variant?: 'compact' | 'full'
}

export function RecommendationScore({ score, breakdown, variant = 'compact' }: RecommendationScoreProps) {
  if (score === null || !breakdown) {
    return <span className={styles.noData}>Балл ещё не посчитан — запись создана до включения обучения</span>
  }

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <span className={styles.value}>{formatShare(score)}</span>
        <span className={styles.source}>{SOURCE_LABEL[breakdown.pSource]}</span>
      </div>
      <ScoreBar parts={partsOf(breakdown)} />
      {variant === 'full' && (
        <>
          <ScoreLegend items={LEGEND_ITEMS} />
          <ul className={styles.detailList}>
            <li>
              Вес правила: {formatShare(breakdown.p)} ({formatNumber(Math.round(breakdown.trialsEff))} показов с учётом
              затухания)
            </li>
            <li>
              Ценность случая: {formatNumber(breakdown.value)} — {breakdown.valueLabel}
            </li>
            <li>Приоритет: {formatShare(breakdown.priority)} от максимального</li>
          </ul>
        </>
      )}
    </div>
  )
}
