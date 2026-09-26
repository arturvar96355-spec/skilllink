'use client'

import { useState } from 'react'
import { type ExperimentStatus, type RecommendationExperimentDto } from '@/shared/contracts'
import {
  Badge,
  type BadgeTone,
  Button,
  Card,
  ErrorState,
  SkeletonLines,
  formatDate,
  formatShare,
  useResource,
} from '@/ui'
import styles from './ExperimentSummary.module.css'

/**
 * «Работают ли рекомендации» (решение 136, п. 4 решения 178): контрольная
 * группа и оценка прироста. Раскрывается по кнопке — расчёт по всему журналу
 * сигналов не нужен на каждом заходе на страницу.
 */

const STATUS_TONE: Record<ExperimentStatus, BadgeTone> = {
  'insufficient-data': 'neutral',
  'not-proven': 'warning',
  lift: 'success',
  negative: 'danger',
}

export function RecommendationExperiment() {
  const [isOpen, setIsOpen] = useState(false)
  const experiment = useResource<RecommendationExperimentDto>(isOpen ? '/api/recommendations/experiment' : null)

  if (!isOpen) {
    return (
      <Button variant="secondary" icon="analytics" onClick={() => setIsOpen(true)}>
        Работают ли рекомендации?
      </Button>
    )
  }

  if (experiment.isLoading) return <SkeletonLines count={4} />
  if (experiment.error) return <ErrorState error={experiment.error} onRetry={experiment.reload} />
  const data = experiment.data
  if (!data) return null
  const overall = data.overall

  return (
    <Card className={styles.card}>
      <div className={styles.head}>
        <span className={styles.title}>Работают ли рекомендации</span>
        <Badge tone={STATUS_TONE[overall.status]}>{overall.statusLabel}</Badge>
      </div>

      {!data.enabled && (
        <p className={styles.note}>
          Эксперимент выключен на этом стенде: рекомендации показываются всем без исключений, каждый сигнал всё равно
          пишется в журнал с отметкой «эксперимент выключен», группа контроля не набирается.
        </p>
      )}

      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.value}>{formatShare(overall.convT)}</span>
          <span className={styles.label}>с рекомендацией, n = {overall.nTreatment}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.value}>{formatShare(overall.convC)}</span>
          <span className={styles.label}>контроль без показа, n = {overall.nControl}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.value}>{overall.lift !== null ? formatShare(overall.lift) : '—'}</span>
          <span className={styles.label}>
            разница{overall.ci ? ` · [${formatShare(overall.ci.low)}; ${formatShare(overall.ci.high)}]` : ''}
          </span>
        </div>
      </div>

      <p className={styles.note}>
        Честная оценка: интервал разности — метод 10 Ньюкомба, порог «хватает данных» — не меньше{' '}
        {data.minControlForVerdict} исходов в каждой группе. Знаменатель — все назначенные сигналы (по хешу правило +
        объект + период), а не только показанные или взятые в работу — иначе оценка была бы смещена в пользу тех,
        кто рекомендацию выполнил.
      </p>

      <p className={styles.note}>
        Журнал: {data.journal.total} сигналов, из них {data.journal.randomized} назначено по хешу. Просрочки сроков и
        критичные сигналы в контроль не уходят никогда.
      </p>

      {data.warnings.length > 0 && (
        <ul className={styles.warnings}>
          {data.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      <span className={styles.note}>Посчитано {formatDate(data.generatedAt)}</span>
    </Card>
  )
}
