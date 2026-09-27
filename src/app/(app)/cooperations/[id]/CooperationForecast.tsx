'use client'

import type { CooperationForecastDto } from '@/shared/contracts'
import { Card, EmptyState, ErrorState, InfoHint, MockBadge, SkeletonLines, formatDate, formatShare, useResource } from '@/ui'
import { CHANCE_WORDS, chanceLevel, forecastEmpty, forecastHeadline, forecastHelp, howWeCount } from './forecast-view'
import styles from './CooperationForecast.module.css'

/**
 * Прогноз «дойдёт ли связка до ближайшей вехи» (решение 135) — плашка на
 * карточке связки. Честная модель: если она не прошла ворота публикации,
 * сервер сам отдаёт оценку простого правила с пометкой источника, а не
 * выдаёт недоказанную модель за надёжную (`ForecastStatus`).
 *
 * Подача (решение 211): у жюри нет времени разбираться, поэтому на виду —
 * вопрос («Шансы дойти до договора за 60 дней»), шансы словами и числом,
 * одна строка «как считаем» и «?» с пояснением. Статус модели, версия,
 * способ расчёта — в раскрываемом «Подробнее для аналитика».
 */
export function CooperationForecast({ cooperationId }: { cooperationId: string }) {
  const forecast = useResource<CooperationForecastDto>(`/api/cooperations/${cooperationId}/forecast`)

  if (forecast.isLoading) return <SkeletonLines count={3} />
  if (forecast.error) return <ErrorState error={forecast.error} onRetry={forecast.reload} />
  const data = forecast.data
  if (!data) return null

  if (data.probability === null || !data.milestone) {
    const empty = forecastEmpty(data)
    return <EmptyState icon="analytics" title={empty.title} description={empty.description} />
  }

  const level = chanceLevel(data.probability)
  // Доводы: у правила — факты «из N случаев дошли M» (info), у модели — «за» и «против».
  const facts = data.explanation.filter((item) => item.direction === 'info')
  const forItems = data.explanation.filter((item) => item.direction === 'for')
  const againstItems = data.explanation.filter((item) => item.direction === 'against')

  return (
    <Card className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.question}>
          {forecastHeadline(data.milestone, data.horizonDays)}
          <InfoHint text={forecastHelp(data, level)} />
        </h3>
        {data.isMock && <MockBadge />}
      </div>

      <p className={styles.verdict} data-level={level}>
        <span className={styles.level}>{CHANCE_WORDS[level]}</span>
        <span className={styles.separator} aria-hidden>
          ·
        </span>
        <span className={styles.probability}>{formatShare(data.probability)}</span>
      </p>

      <p className={styles.how}>
        <span className={styles.howLabel}>Как считаем:</span> {howWeCount(data.source).toLowerCase()}
      </p>

      {facts.length > 0 && (
        <ul className={styles.facts}>
          {facts.map((item) => (
            <li key={item.text}>{item.text}</li>
          ))}
        </ul>
      )}

      {(forItems.length > 0 || againstItems.length > 0) && (
        <div className={styles.reasons}>
          {forItems.length > 0 && (
            <div>
              <span className={styles.reasonsTitle}>Что повышает шансы</span>
              <ul className={styles.explanation}>
                {forItems.map((item) => (
                  <li key={item.feature} className={styles.explanationItem} data-direction="for">
                    <span className={styles.explanationMark} aria-hidden="true">
                      +
                    </span>
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {againstItems.length > 0 && (
            <div>
              <span className={styles.reasonsTitle}>Что снижает шансы</span>
              <ul className={styles.explanation}>
                {againstItems.map((item) => (
                  <li key={item.feature} className={styles.explanationItem} data-direction="against">
                    <span className={styles.explanationMark} aria-hidden="true">
                      −
                    </span>
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {data.notes.length > 0 && (
        <ul className={styles.notes}>
          {data.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      <details className={styles.details}>
        <summary>Подробнее для аналитика</summary>
        <dl className={styles.detailsList}>
          <div>
            <dt>Способ</dt>
            <dd>
              {data.source === 'model'
                ? 'Логистическая модель, обученная на истории связок'
                : 'Правило: частота достижения цели у связок на том же этапе'}
            </dd>
          </div>
          <div>
            <dt>Статус</dt>
            <dd>
              {data.statusLabel}. {data.summary}
            </dd>
          </div>
          <div>
            <dt>Модель</dt>
            <dd>
              {data.modelVersion !== null ? `Версия ${data.modelVersion}` : 'Не обучалась'}
              {data.trainedAt ? `, обучена ${formatDate(data.trainedAt)}` : ''}
            </dd>
          </div>
        </dl>
      </details>
    </Card>
  )
}
