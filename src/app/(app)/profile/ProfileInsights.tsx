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
 *
 * Расчёт идёт по всей истории связок и на стенде бывает небыстрым. Раньше на это
 * время блок был одной серой плашкой без слов — эксперт принял её за пустой блок
 * (проверка продукт-менеджера 27.09, решение 205). Теперь загрузка — строки в форме
 * будущих пунктов и подпись, что идёт проверка; пусто — прямым текстом.
 */
const LOADING_ROWS = 3
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
        <div className={styles.loading}>
          <p className={styles.loadingText} role="status">
            Система сверяет встречи, движение этапов и сроки с обычным ходом дел…
          </p>
          <ul className={styles.list} aria-hidden="true">
            {Array.from({ length: LOADING_ROWS }, (_, index) => (
              <li key={index} className={styles.item}>
                <span className={[styles.dot, styles.dotPending].join(' ')} />
                <span className={styles.itemText}>
                  <Skeleton width={index === 1 ? '38%' : '52%'} height="14px" />
                  <Skeleton width={index === 2 ? '64%' : '86%'} height="12px" />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : insights.error ? (
        <ErrorState error={insights.error} onRetry={insights.reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Система пока ничего необычного не заметила"
          description="Встречи, движение этапов и сроки идут как обычно. Отклонения появятся здесь, как только система их увидит."
        />
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
