'use client'

import Link from 'next/link'
import styles from './Ticker.module.css'

/**
 * Бегущая строка событий (решение 79, по образцу New Zealanderlivery Service).
 *
 * Лента повторена дважды и уезжает на свою ширину — шов не виден. Наведение
 * или фокус ставит строку на паузу; «уменьшить движение» — строка стоит и
 * прокручивается вручную. Каждое событие — ссылка на объект.
 */
export interface TickerItem {
  key: string
  text: string
  href: string
  tone: 'danger' | 'warning' | 'info'
}

export function Ticker({ items, label }: { items: TickerItem[]; label: string }) {
  if (items.length === 0) return null
  // Скорость — от длины ленты: короткая не должна мелькать, длинная — ползти.
  const duration = Math.max(30, items.reduce((sum, item) => sum + item.text.length, 0) * 0.28)
  const track = (hidden: boolean) =>
    items.map((item) => (
      <Link
        key={`${hidden ? 'b' : 'a'}-${item.key}`}
        href={item.href}
        className={`${styles.item} ${styles[item.tone]}`}
        tabIndex={hidden ? -1 : undefined}
        aria-hidden={hidden || undefined}
      >
        <span className={styles.dot} aria-hidden />
        {item.text}
      </Link>
    ))
  return (
    <section className={styles.root} aria-label={label}>
      <div className={styles.track} style={{ animationDuration: `${duration}s` }}>
        {track(false)}
        {track(true)}
      </div>
    </section>
  )
}
