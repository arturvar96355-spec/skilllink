'use client'

import Link from 'next/link'
import type { InsightDto } from '@/shared/contracts'
import { EmptyState, ErrorState, Skeleton, useResource } from '@/ui'
import profileStyles from './profile.module.css'
import styles from './ProfileSignals.module.css'

/**
 * «Система заметила» (решение 120) на вебе — раньше текст был только
 * в сводке Telegram-бота. Без модели: отклонения рядов по шаблонам,
 * каждое число в тексте есть в `facts`.
 */
export function ProfileInsights() {
  const insights = useResource<InsightDto[]>('/api/analytics/insights')
  const rows = insights.data ?? []

  return (
    <section className={profileStyles.block} aria-labelledby="profile-insights">
      <div className={profileStyles.blockHead}>
        <h2 id="profile-insights" className={profileStyles.blockTitle}>
          Система заметила
        </h2>
      </div>

      {insights.isLoading ? (
        <Skeleton width="100%" height="80px" />
      ) : insights.error ? (
        <ErrorState error={insights.error} onRetry={insights.reload} />
      ) : rows.length === 0 ? (
        <EmptyState title="Отклонений нет" description="За последнее время система не заметила ничего необычного." />
      ) : (
        <ul className={styles.list}>
          {rows.slice(0, 5).map((item) => {
            const content = (
              <span className={styles.itemText}>
                <span className={styles.itemTitle}>{item.title}</span>
                <span className={styles.itemDetail}>{item.detail}</span>
              </span>
            )
            return (
              <li key={item.code + item.title} className={styles.item}>
                <span className={[styles.dot, styles[item.severity] ?? ''].join(' ')} aria-hidden="true" />
                {item.link ? (
                  <Link className={styles.itemLink} href={item.link}>
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
