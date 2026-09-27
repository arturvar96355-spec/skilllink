'use client'

import { useRef, type CSSProperties } from 'react'
import { useReveal } from '../hooks/reveal'
import { gapBarMetrics } from './gap-bars'
import styles from './GapBars.module.css'

/**
 * Самые большие дефициты навыков (решение 94, исправлено решением 197): полоса —
 * спрос рынка на навык (0–100), закрашенная бирюзой часть — сколько из него
 * покрывают программы. Незакрытый остаток и есть дефицит — он виден глазом
 * по длине полосы. Число справа от полосы — сам дефицит (не спрос: раньше
 * подпись и число называли его «спросом», хотя список уже сортировался по
 * дефициту (решение 197) — путаница была в отображении, не в порядке).
 * Критичные — фирменным розовым. Полосы вырастают одна за другой.
 */

export interface GapRow {
  key: string
  name: string
  /** Спрос, 0..1. */
  demand: number
  /** Покрытие программами, 0..1 — абсолютное значение на шкале спроса, не доля от него. */
  coverage: number
  /** Дефицит, 0..1 (`SkillGapDto.gap`) — то же число, что и остальная система. */
  gap: number
  isCritical: boolean
  explanation: string
}

export function GapBars({ rows }: { rows: GapRow[] }) {
  const ref = useRef<HTMLUListElement>(null)
  const inView = useReveal(ref)

  return (
    <ul ref={ref} className={styles.list} data-inview={inView || undefined}>
      {rows.map((row, index) => {
        const { demandPercent, coveredShareOfBar } = gapBarMetrics(row.demand, row.coverage)
        // Дефицит берётся из DTO, а не пересчитывается из демо/покрытия на глаз:
        // это то же число, что показывают аналитика и объяснение под полосой.
        const gapValue = Math.round(Math.max(0, Math.min(row.gap, 1)) * 100)
        return (
          <li key={row.key} className={styles.row} style={{ '--r': index } as CSSProperties} title={row.explanation}>
            <span className={styles.name}>{row.name}</span>
            <span className={styles.track}>
              <span
                className={[styles.demand, row.isCritical ? styles.critical : ''].filter(Boolean).join(' ')}
                style={{ width: `${demandPercent}%` }}
              >
                <span className={styles.covered} style={{ width: `${coveredShareOfBar}%` }} />
              </span>
            </span>
            <span className={styles.value}>{gapValue}</span>
          </li>
        )
      })}
    </ul>
  )
}
