'use client'

import { useState } from 'react'
import { motion } from 'motion/react'
import { usePrefersReducedMotion } from '../hooks/dom'
import { formatNumber } from '../lib/format'
import styles from './Funnel.module.css'

/**
 * Воронка по шагам (решение 74, по образцу Bklit Funnel).
 *
 * Одна величина — один оттенок: полоса сужается от шага к шагу, ширина ленты —
 * сколько дошло. Подписи и числа — цветом текста, не цветом полосы. Шаги
 * вырастают по очереди слева направо; при наведении — подсказка с разбором шага.
 * Под графиком те же числа списком — это и есть табличное представление.
 */

export interface FunnelStep {
  key: string
  label: string
  /** Сколько дошло до шага. */
  value: number
  /** Строка для подсказки: что именно посчитано. */
  detail: string
}

const HEIGHT = 160
/** Самый узкий шаг не исчезает совсем — иначе пустой шаг не на что навести. */
const MIN_SHARE = 0.04
/** Зазор фона между шагами, как у соседних полос (2 px в масштабе графика). */
const GAP = 2

function halfHeight(value: number, max: number): number {
  const share = max > 0 ? Math.max(value / max, MIN_SHARE) : MIN_SHARE
  return (share * HEIGHT) / 2
}

export function Funnel({ steps, label }: { steps: FunnelStep[]; label: string }) {
  const reduced = usePrefersReducedMotion()
  const [hovered, setHovered] = useState<number | null>(null)
  const max = steps[0]?.value ?? 0
  const width = steps.length * 100
  const mid = HEIGHT / 2

  return (
    <figure className={styles.root} aria-label={label}>
      <div className={styles.plot} onPointerLeave={() => setHovered(null)}>
        <svg
          className={styles.svg}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          preserveAspectRatio="none"
          aria-hidden
        >
          {steps.map((step, index) => {
            const from = halfHeight(step.value, max)
            // Лента сужается к следующему шагу; последний держит свою ширину.
            const next = steps[index + 1]
            const to = next ? halfHeight(next.value, max) : from
            const x0 = index * 100 + (index === 0 ? 0 : GAP / 2)
            const x1 = (index + 1) * 100 - (index === steps.length - 1 ? 0 : GAP / 2)
            const d = `M${x0},${mid - from} L${x1},${mid - to} L${x1},${mid + to} L${x0},${mid + from} Z`
            const dimmed = hovered !== null && hovered !== index
            return (
              <motion.path
                key={step.key}
                d={d}
                className={styles.band}
                style={{ transformOrigin: `${x0}px ${mid}px`, transformBox: 'view-box' }}
                initial={reduced ? false : { scaleY: 0, opacity: 0 }}
                animate={{ scaleY: 1, opacity: dimmed ? 0.35 : 1 - index * 0.12 }}
                transition={{
                  scaleY: { duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: index * 0.09 },
                  opacity: { duration: 0.25 },
                }}
              />
            )
          })}
        </svg>

        {/* Зоны наведения — во весь шаг, шире самой полосы. */}
        <div className={styles.hits}>
          {steps.map((step, index) => (
            <span
              key={step.key}
              className={styles.hit}
              onPointerEnter={() => setHovered(index)}
              onFocus={() => setHovered(index)}
              onBlur={() => setHovered(null)}
              tabIndex={0}
              aria-label={`${step.label}: ${formatNumber(step.value)}. ${step.detail}`}
            >
              {hovered === index && (
                <span className={styles.tooltip} role="tooltip">
                  <span className={styles.tooltipTitle}>{step.label}</span>
                  <span className={styles.tooltipValue}>{formatNumber(step.value)}</span>
                  <span className={styles.tooltipText}>{step.detail}</span>
                </span>
              )}
            </span>
          ))}
        </div>
      </div>

      <ol className={styles.legend}>
        {steps.map((step, index) => {
          const share = max > 0 ? Math.round((step.value / max) * 100) : null
          const previous = steps[index - 1]
          const conversion =
            previous && previous.value > 0 ? Math.round((step.value / previous.value) * 100) : null
          return (
            <li key={step.key} className={hovered === index ? styles.active : undefined}>
              <span className={styles.stepLabel}>{step.label}</span>
              <span className={styles.stepValue}>{formatNumber(step.value)}</span>
              <span className={styles.stepShare}>
                {share === null ? 'Нет данных' : `${share}% от всех`}
                {conversion !== null && <> · {conversion}% с прошлого</>}
              </span>
            </li>
          )
        })}
      </ol>
    </figure>
  )
}
