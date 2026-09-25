'use client'

import { useRef, type CSSProperties } from 'react'
import { useReveal } from '../hooks/reveal'
import styles from './GapBars.module.css'

/**
 * Самые большие дефициты навыков (решение 94): полоса — спрос рынка на навык
 * (0–100), закрашенная часть — сколько из него покрывают программы. Незакрытый
 * остаток и есть дефицит — он виден глазом, без подписи «0,77». Критичные —
 * фирменным розовым. Полосы вырастают одна за другой.
 */

export interface GapRow {
  key: string
  name: string
  /** Спрос, 0..1. */
  demand: number
  /** Покрытие программами, 0..1 от спроса. */
  coverage: number
  isCritical: boolean
  explanation: string
}

export function GapBars({ rows }: { rows: GapRow[] }) {
  const ref = useRef<HTMLUListElement>(null)
  const inView = useReveal(ref)

  return (
    <ul ref={ref} className={styles.list} data-inview={inView || undefined}>
      {rows.map((row, index) => {
        const demand = Math.max(0, Math.min(row.demand, 1)) * 100
        const covered = demand * Math.max(0, Math.min(row.coverage, 1))
        return (
          <li key={row.key} className={styles.row} style={{ '--r': index } as CSSProperties} title={row.explanation}>
            <span className={styles.name}>{row.name}</span>
            <span className={styles.track}>
              <span
                className={[styles.demand, row.isCritical ? styles.critical : ''].filter(Boolean).join(' ')}
                style={{ width: `${demand}%` }}
              >
                <span className={styles.covered} style={{ width: demand > 0 ? `${(covered / demand) * 100}%` : 0 }} />
              </span>
            </span>
            <span className={styles.value}>{Math.round(demand)}</span>
          </li>
        )
      })}
    </ul>
  )
}
