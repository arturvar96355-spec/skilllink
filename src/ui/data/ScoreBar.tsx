'use client'

import { useRef, type CSSProperties } from 'react'
import { formatNumber, formatScore } from '../lib/format'
import { useReveal } from '../hooks/reveal'
import styles from './ScoreBar.module.css'

/**
 * Балл, разложенный на вклады (решение 87): полоса длиной в балл из 100, внутри —
 * отрезки факторов рейтинга в их цветах (заявки, обучающиеся, группы — решение 7,
 * других факторов в балле нет). Полоса вырастает слева, отрезки — один за другим.
 * Фактор без данных в полосу не входит и назван в подсказке «нет данных».
 */

export interface ScorePart {
  key: string
  title: string
  /** Сколько баллов фактор дал; `null` — показателя нет. */
  contribution: number | null
  value: number | null
}

/** Цвета факторов — те же, что в разборе рейтинга на странице аналитики. */
const TONE: Record<string, string> = {
  applicationCount: styles.violet!,
  studentCount: styles.pink!,
  groupCount: styles.cyan!,
}

export function ScoreBar({ parts, delay = 0 }: { parts: ScorePart[]; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useReveal(ref)

  return (
    <span
      ref={ref}
      className={styles.track}
      data-inview={inView || undefined}
      style={{ '--delay': `${delay}ms` } as CSSProperties}
    >
      {parts
        .filter((part) => part.contribution !== null && part.contribution > 0)
        .map((part, index) => (
          <span
            key={part.key}
            className={[styles.part, TONE[part.key] ?? ''].filter(Boolean).join(' ')}
            style={{ width: `${Math.min(part.contribution!, 100)}%`, '--p': index } as CSSProperties}
            title={`${part.title}: ${formatNumber(part.value)} → ${formatScore(part.contribution!)} балла`}
          />
        ))}
    </span>
  )
}

/** Подпись цветов под списком: какой цвет какой фактор. */
export function ScoreLegend({ items }: { items: Array<{ key: string; title: string }> }) {
  return (
    <span className={styles.legend}>
      {items.map((item) => (
        <span key={item.key} className={[styles.legendItem, TONE[item.key] ?? ''].filter(Boolean).join(' ')}>
          {item.title}
        </span>
      ))}
    </span>
  )
}
