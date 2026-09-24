'use client'

import { motion } from 'motion/react'
import { usePrefersReducedMotion } from '../hooks/dom'
import styles from './Ring.module.css'

/**
 * Кольцо прогресса (решение 79, по образцу Bklit Ring / Apple Activity из Kokonut).
 *
 * Одна доля из 100 — дуга по кругу, число в центре. Нет данных — пустое кольцо
 * и «Нет данных», а не ноль (решение 8). Дуга дорисовывается при появлении.
 */
export function Ring({
  value,
  label,
  caption,
  tone = 'violet',
  delay = 0,
}: {
  /** 0..100 или null — «Нет данных». */
  value: number | null
  label: string
  caption?: string
  tone?: 'violet' | 'cyan' | 'pink'
  delay?: number
}) {
  const reduced = usePrefersReducedMotion()
  const share = value === null ? 0 : Math.max(0, Math.min(100, value)) / 100
  const text = value === null ? 'Нет данных' : `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`
  return (
    <figure className={`${styles.root} ${styles[tone]}`} aria-label={`${label}: ${text}`}>
      <svg viewBox="0 0 120 120" className={styles.svg} aria-hidden>
        <circle cx="60" cy="60" r="50" className={styles.track} />
        <motion.circle
          cx="60"
          cy="60"
          r="50"
          className={styles.arc}
          style={{ rotate: -90, transformOrigin: '60px 60px' }}
          initial={reduced ? false : { pathLength: 0 }}
          animate={{ pathLength: share }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1], delay }}
        />
      </svg>
      <span className={`${styles.value} ${value === null ? styles.empty : ''}`}>{text}</span>
      <figcaption className={styles.caption}>
        <span className={styles.label}>{label}</span>
        {caption && <span className={styles.note}>{caption}</span>}
      </figcaption>
    </figure>
  )
}
