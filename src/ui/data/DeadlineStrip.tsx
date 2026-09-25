'use client'

import Link from 'next/link'
import { useRef, type CSSProperties } from 'react'
import { useInView } from 'motion/react'
import { formatNumber, pluralize } from '../lib/format'
import styles from './DeadlineStrip.module.css'

/**
 * Шкала просрочек (решение 87): каждый проблемный этап — точка на оси «сколько
 * дней срок уже прошёл», справа — сегодня, слева — самые давние. Заблокированные
 * без срока стоят отдельной меткой справа от «сегодня». Одним взглядом видно,
 * насколько всё плохо и где скопление, — то, что список из десяти строк прячет.
 *
 * Точки выезжают из «сегодня» на своё место, когда шкала доходит до экрана.
 * Наведение на точку подсвечивает её вуз во всей главной (`onFocus`).
 */

export interface DeadlineItem {
  key: string
  /** Подпись: «СПбГУТ — Программная инженерия». */
  label: string
  /** Сколько дней просрочен этап; `null` — заблокирован без просрочки. */
  daysOverdue: number | null
  href: string
  /** Кого подсвечивать при наведении: вуз связки. */
  group: string
}

/** Деления оси — «красивые» числа, чтобы подписи читались сразу. */
function niceMax(max: number): number {
  const steps = [7, 14, 30, 60, 90, 120, 180, 365]
  return steps.find((step) => step >= max) ?? Math.ceil(max / 100) * 100
}

export function DeadlineStrip({
  items,
  focus,
  onFocus,
}: {
  items: DeadlineItem[]
  focus: string | null
  onFocus: (group: string | null) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' })

  const overdue = items.filter((item) => item.daysOverdue !== null)
  const blocked = items.filter((item) => item.daysOverdue === null)
  const max = niceMax(Math.max(1, ...overdue.map((item) => item.daysOverdue!)))
  const ticks = [max, Math.round(max / 2), 0]

  // Точки с почти одинаковой просрочкой — друг над другом, а не одна на другой.
  const lanes = new Map<number, number>()
  const placed = overdue
    .slice()
    .sort((a, b) => b.daysOverdue! - a.daysOverdue!)
    .map((item, index) => {
      const at = 100 - (item.daysOverdue! / max) * 100
      const bucket = Math.round(at / 4)
      const lane = lanes.get(bucket) ?? 0
      lanes.set(bucket, lane + 1)
      return { item, index, at, lane }
    })

  return (
    <div
      ref={ref}
      className={styles.strip}
      data-inview={inView || undefined}
      role="img"
      aria-label={`Просрочено этапов: ${overdue.length}, самый давний — ${formatNumber(max)} дней; заблокировано: ${blocked.length}`}
    >
      <div className={styles.axis}>
        <span className={styles.line} aria-hidden />
        {/* Краснота нарастает к давним — сама ось говорит «чем левее, тем хуже». */}
        <span className={styles.heat} aria-hidden />
        {ticks.map((tick) => (
          <span key={tick} className={styles.tick} style={{ left: `${100 - (tick / max) * 100}%` }} aria-hidden>
            <span className={styles.tickLabel}>{tick === 0 ? 'сегодня' : `−${formatNumber(tick)} дн.`}</span>
          </span>
        ))}

        {placed.map(({ item, index, at, lane }) => (
          <Link
            key={item.key}
            href={item.href}
            className={[styles.dot, focus && focus !== item.group ? styles.dim : ''].filter(Boolean).join(' ')}
            style={{ '--at': `${at}%`, '--lane': lane, '--i': index } as CSSProperties}
            title={`${item.label}\nПросрочен на ${formatNumber(item.daysOverdue)} ${pluralize(item.daysOverdue!, ['день', 'дня', 'дней'])}`}
            aria-label={`${item.label}: просрочен на ${formatNumber(item.daysOverdue)} дн.`}
            onPointerEnter={() => onFocus(item.group)}
            onPointerLeave={() => onFocus(null)}
            onFocus={() => onFocus(item.group)}
            onBlur={() => onFocus(null)}
          />
        ))}
      </div>

      {blocked.length > 0 && (
        <div className={styles.blocked}>
          {blocked.map((item, index) => (
            <Link
              key={item.key}
              href={item.href}
              className={[styles.block, focus && focus !== item.group ? styles.dim : ''].filter(Boolean).join(' ')}
              style={{ '--i': placed.length + index } as CSSProperties}
              title={`${item.label}\nЗаблокирован`}
              aria-label={`${item.label}: заблокирован`}
              onPointerEnter={() => onFocus(item.group)}
              onPointerLeave={() => onFocus(null)}
              onFocus={() => onFocus(item.group)}
              onBlur={() => onFocus(null)}
            />
          ))}
          <span className={styles.tickLabel}>блок</span>
        </div>
      )}
    </div>
  )
}
