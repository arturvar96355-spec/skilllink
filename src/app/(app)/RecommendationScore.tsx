import type { RecommendationScoreDto } from '@/shared/contracts'
import { InfoHint, ScoreBar, ScoreLegend, formatNumber, formatShare } from '@/ui'
import { partsOf } from './recommendation-score'
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

/**
 * Что значит число — для «?» рядом (решение 211): «68% по своим решениям»
 * без пояснения эксперт не прочтёт. Источник веса — словами, а не кодом.
 */
const SOURCE_HINT: Record<RecommendationScoreDto['pSource'], string> = {
  local: 'сотрудники уже не раз решали по таким советам — берётся, как часто их принимали.',
  pooled: 'своих решений по этому совету пока мало — добавлена оценка по похожим советам.',
  global: 'своих решений по этому совету ещё нет — взята общая оценка по всем советам.',
}

function scoreHint(source: RecommendationScoreDto['pSource']): string {
  return (
    'Важность совета от 0 до 100%: чем выше, тем раньше за него стоит взяться. ' +
    'Складывается из трёх частей (полоса): насколько такие советы оказывались полезны, насколько ценен случай и его приоритет.\n' +
    `Полезность — ${SOURCE_HINT[source]}`
  )
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
        <span className={styles.source}>важность совета · {SOURCE_LABEL[breakdown.pSource]}</span>
        <InfoHint text={scoreHint(breakdown.pSource)} />
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
