'use client'

import { useState } from 'react'
import { motion } from 'motion/react'
import { useCalmMotion } from '../hooks/ui-mode'
import { formatNumber } from '../lib/format'
import styles from './Funnel.module.css'

/**
 * Воронка по шагам (решения 74 и 79, по образцу Bklit Funnel).
 *
 * Одна величина — один оттенок. Лента из плавных кривых: каждый шаг держит свою
 * высоту и мягко сужается к следующему; вокруг — два полупрозрачных ореола.
 * Над шагом — значение, посередине — доля от первого шага в «таблетке», под
 * ним — название. Лента вырастает из середины, ореолы — следом. Наведение или
 * фокус на шаг — подсказка с разбором; остальные шаги приглушаются.
 */

export interface FunnelStep {
  key: string
  label: string
  /** Сколько дошло до шага. */
  value: number
  /** Строка для подсказки: что именно посчитано. */
  detail: string
}

const HEIGHT = 180
/** Самый узкий шаг не исчезает совсем — иначе пустой шаг не на что навести. */
const MIN_SHARE = 0.05
/** Доля шага, которую занимает «полка» до сужения к следующему. */
const PLATEAU = 0.55

function half(value: number, max: number, scale: number): number {
  const share = max > 0 ? Math.max(value / max, MIN_SHARE) : MIN_SHARE
  return ((share * HEIGHT) / 2) * scale
}

/** Контур ленты: полки и кривые сужения сверху, зеркально — снизу. */
function bandPath(values: number[], max: number, scale: number, clampTo: number): string {
  const mid = HEIGHT / 2
  const h = values.map((value) => Math.min(half(value, max, scale), clampTo))
  const top: string[] = []
  const bottom: string[] = []
  values.forEach((_, i) => {
    const x0 = i * 100
    const plateauEnd = x0 + 100 * PLATEAU
    const x1 = (i + 1) * 100
    const next = h[i + 1] ?? h[i]!
    if (i === 0) top.push(`M${x0},${mid - h[i]!}`)
    top.push(`L${plateauEnd},${mid - h[i]!}`)
    const c = (x1 - plateauEnd) / 2
    top.push(`C${plateauEnd + c},${mid - h[i]!} ${x1 - c},${mid - next} ${x1},${mid - next}`)
  })
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const x0 = i * 100
    const plateauEnd = x0 + 100 * PLATEAU
    const x1 = (i + 1) * 100
    const next = h[i + 1] ?? h[i]!
    const c = (x1 - plateauEnd) / 2
    bottom.push(`C${x1 - c},${mid + next} ${plateauEnd + c},${mid + h[i]!} ${plateauEnd},${mid + h[i]!}`)
    bottom.push(`L${x0},${mid + h[i]!}`)
  }
  const last = values.length * 100
  const hLast = h[h.length - 1]!
  return `${top.join(' ')} L${last},${mid + hLast} ${bottom.join(' ')} Z`
}

export function Funnel({ steps, label }: { steps: FunnelStep[]; label: string }) {
  const reduced = useCalmMotion()
  const [hovered, setHovered] = useState<number | null>(null)
  const max = steps[0]?.value ?? 0
  const values = steps.map((step) => step.value)
  const width = steps.length * 100
  const grow = (delay: number) =>
    reduced
      ? {}
      : {
          initial: { scaleY: 0, opacity: 0 },
          animate: { scaleY: 1, opacity: 1 },
          transition: { duration: 0.9, ease: [0.16, 1, 0.3, 1] as const, delay },
        }

  return (
    <figure className={styles.root} aria-label={label}>
      <div className={styles.values} aria-hidden>
        {steps.map((step, index) => (
          <span key={step.key} className={hovered !== null && hovered !== index ? styles.dim : undefined}>
            {formatNumber(step.value)}
          </span>
        ))}
      </div>

      <div className={styles.plot} onPointerLeave={() => setHovered(null)}>
        <svg className={styles.svg} viewBox={`0 0 ${width} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden>
          {/* Ореолы — та же лента шире и прозрачнее: глубина без второго цвета.
              Основная лента — 60 % высоты, чтобы ореолы были видны и у первого шага. */}
          <motion.path
            d={bandPath(values, max, 0.95, HEIGHT / 2)}
            className={`${styles.band} ${styles.halo2}`}
            style={{ transformOrigin: 'center', transformBox: 'view-box' }}
            {...grow(0.25)}
          />
          <motion.path
            d={bandPath(values, max, 0.78, HEIGHT / 2)}
            className={`${styles.band} ${styles.halo1}`}
            style={{ transformOrigin: 'center', transformBox: 'view-box' }}
            {...grow(0.12)}
          />
          <motion.path
            d={bandPath(values, max, 0.6, HEIGHT / 2)}
            className={styles.band}
            style={{ transformOrigin: 'center', transformBox: 'view-box' }}
            {...grow(0)}
          />
          {/* Разделители шагов — зазор фона, как между соседними полосами. */}
          {steps.slice(1).map((step, index) => (
            <line
              key={step.key}
              x1={(index + 1) * 100}
              x2={(index + 1) * 100}
              y1={0}
              y2={HEIGHT}
              className={styles.divider}
            />
          ))}
        </svg>

        {/* Доля от первого шага — «таблетка» посередине шага. */}
        <div className={styles.pills} aria-hidden>
          {steps.map((step, index) => {
            const share = max > 0 ? Math.round((step.value / max) * 100) : null
            return (
              <motion.span
                key={step.key}
                className={`${styles.pill} ${hovered !== null && hovered !== index ? styles.dim : ''}`}
                initial={reduced ? false : { opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: reduced ? 0 : 0.5 + index * 0.08, duration: 0.3 }}
              >
                {share === null ? '—' : `${share}%`}
              </motion.span>
            )
          })}
        </div>

        {/* Зоны наведения — во весь шаг, шире самой ленты. */}
        <div className={styles.hits}>
          {steps.map((step, index) => {
            const previous = steps[index - 1]
            const conversion = previous && previous.value > 0 ? Math.round((step.value / previous.value) * 100) : null
            return (
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
                    {conversion !== null && (
                      <span className={styles.tooltipText}>{conversion}% дошли с прошлой фазы</span>
                    )}
                  </span>
                )}
              </span>
            )
          })}
        </div>
      </div>

      <ol className={styles.labels}>
        {steps.map((step, index) => (
          <li key={step.key} className={hovered !== null && hovered !== index ? styles.dim : undefined}>
            {step.label}
          </li>
        ))}
      </ol>
    </figure>
  )
}
