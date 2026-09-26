'use client'

import { FORECAST_STATUS_LABELS, type CooperationForecastDto } from '@/shared/contracts'
import { Badge, Card, EmptyState, ErrorState, MockBadge, SkeletonLines, formatShare, useResource } from '@/ui'
import styles from './CooperationForecast.module.css'

/**
 * Прогноз «дойдёт ли связка до ближайшей вехи» (решение 135) — плашка на
 * карточке связки. Честная модель: если она не прошла ворота публикации,
 * сервер сам отдаёт оценку простого правила с пометкой источника, а не
 * выдаёт недоказанную модель за надёжную (`ForecastStatus`).
 */

/** Тон значка статуса: у модели, прошедшей ворота, — акцент, у остального — нейтрально. */
function statusTone(status: CooperationForecastDto['status']): 'accent' | 'warning' | 'neutral' {
  if (status === 'preliminary') return 'accent'
  if (status === 'stale') return 'warning'
  return 'neutral'
}

export function CooperationForecast({ cooperationId }: { cooperationId: string }) {
  const forecast = useResource<CooperationForecastDto>(`/api/cooperations/${cooperationId}/forecast`)

  if (forecast.isLoading) return <SkeletonLines count={3} />
  if (forecast.error) return <ErrorState error={forecast.error} onRetry={forecast.reload} />
  const data = forecast.data
  if (!data) return null

  if (data.probability === null || !data.milestone) {
    return (
      <EmptyState
        icon="analytics"
        title={FORECAST_STATUS_LABELS[data.status]}
        description={data.summary}
      />
    )
  }

  return (
    <Card className={styles.card}>
      <div className={styles.head}>
        <span className={styles.goal}>
          Дойдёт до {data.milestone.goal} за {data.horizonDays} дн.
        </span>
        <span className={styles.meta}>
          <Badge tone={statusTone(data.status)}>{data.statusLabel}</Badge>
          {data.isMock && <MockBadge />}
        </span>
      </div>

      <div className={styles.probabilityRow}>
        <span className={styles.probability}>{formatShare(data.probability)}</span>
        <span className={styles.goal}>{data.source === 'model' ? 'оценка модели' : 'оценка по правилу'}</span>
      </div>

      <p className={styles.summary}>{data.summary}</p>

      {data.explanation.length > 0 && (
        <ul className={styles.explanation}>
          {data.explanation.map((item) => (
            <li key={item.feature} className={styles.explanationItem} data-direction={item.direction}>
              <span className={styles.explanationMark} aria-hidden="true">
                {item.direction === 'for' ? '+' : item.direction === 'against' ? '−' : '·'}
              </span>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      )}

      {data.notes.length > 0 && (
        <ul className={styles.notes}>
          {data.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      <span className={styles.meta}>
        {data.modelVersion !== null ? `Модель версии ${data.modelVersion}` : 'Оценка без обученной модели'}
      </span>
    </Card>
  )
}
