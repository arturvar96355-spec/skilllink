'use client'

import { useState } from 'react'
import { motion } from 'motion/react'
import { usePrefersReducedMotion } from '../hooks/dom'
import styles from './Radar.module.css'

/**
 * Радар (решение 79, по образцу Bklit Radar): несколько величин 0..1 по осям,
 * две серии поверх друг друга. Для программы — спрос рынка против покрытия:
 * где синий выходит за фиолетовый, там дефицит. Две серии — легенда и подписи
 * значений в подсказке; цвет не единственный признак (у спроса пунктир).
 */
export interface RadarAxis {
  key: string
  label: string
  /** Значения серий 0..1 или null — «Нет данных». */
  values: Array<number | null>
}

export interface RadarSeries {
  label: string
  tone: 'violet' | 'cyan'
  dashed?: boolean
}

const SIZE = 360
const R = 130
const C = SIZE / 2

function point(index: number, count: number, share: number): [number, number] {
  const angle = (Math.PI * 2 * index) / count - Math.PI / 2
  return [C + Math.cos(angle) * R * share, C + Math.sin(angle) * R * share]
}

export function Radar({ axes, series, label }: { axes: RadarAxis[]; series: RadarSeries[]; label: string }) {
  const reduced = usePrefersReducedMotion()
  const [hovered, setHovered] = useState<number | null>(null)
  const count = axes.length
  if (count < 3) return null

  return (
    <figure className={styles.root} aria-label={label}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className={styles.svg}>
        {[0.25, 0.5, 0.75, 1].map((share) => (
          <polygon
            key={share}
            className={styles.grid}
            points={axes.map((_, index) => point(index, count, share).join(',')).join(' ')}
          />
        ))}
        {axes.map((axis, index) => {
          const [x, y] = point(index, count, 1)
          const [lx, ly] = point(index, count, 1.17)
          return (
            <g key={axis.key}>
              <line x1={C} y1={C} x2={x} y2={y} className={styles.spoke} />
              <text
                x={lx}
                y={ly}
                className={`${styles.axisLabel} ${hovered === index ? styles.axisActive : ''}`}
                textAnchor={Math.abs(lx - C) < 8 ? 'middle' : lx > C ? 'start' : 'end'}
                dominantBaseline="middle"
              >
                {axis.label.length > 16 ? `${axis.label.slice(0, 15)}…` : axis.label}
              </text>
            </g>
          )
        })}
        {series.map((item, s) => {
          const pts = axes.map((axis, index) => point(index, count, axis.values[s] ?? 0).join(',')).join(' ')
          return (
            <motion.polygon
              key={item.label}
              points={pts}
              className={`${styles.area} ${styles[item.tone]} ${item.dashed ? styles.dashed : ''}`}
              initial={reduced ? false : { scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.8, delay: s * 0.15, ease: [0.16, 1, 0.3, 1] }}
              style={{ transformOrigin: `${C}px ${C}px`, transformBox: 'view-box' }}
            />
          )
        })}
        {/* Зоны наведения по осям — точки на внешнем круге. */}
        {axes.map((axis, index) => {
          const [x, y] = point(index, count, 1)
          return (
            <circle
              key={axis.key}
              cx={x}
              cy={y}
              r={16}
              className={styles.hit}
              tabIndex={0}
              aria-label={`${axis.label}: ${series.map((item, s) => `${item.label} ${axis.values[s] === null ? 'нет данных' : `${Math.round((axis.values[s] ?? 0) * 100)}%`}`).join(', ')}`}
              onPointerEnter={() => setHovered(index)}
              onPointerLeave={() => setHovered(null)}
              onFocus={() => setHovered(index)}
              onBlur={() => setHovered(null)}
            />
          )
        })}
      </svg>
      {hovered !== null && axes[hovered] && (
        <div className={styles.tooltip} role="tooltip">
          <span className={styles.tooltipTitle}>{axes[hovered].label}</span>
          {series.map((item, s) => (
            <span key={item.label} className={styles.tooltipRow}>
              <span className={`${styles.swatch} ${styles[item.tone]}`} />
              {item.label}:{' '}
              <strong>
                {axes[hovered]!.values[s] === null
                  ? 'нет данных'
                  : `${Math.round((axes[hovered]!.values[s] ?? 0) * 100)}%`}
              </strong>
            </span>
          ))}
        </div>
      )}
      <figcaption className={styles.legend}>
        {series.map((item) => (
          <span key={item.label} className={styles.legendItem}>
            <span className={`${styles.swatch} ${styles[item.tone]} ${item.dashed ? styles.swatchDashed : ''}`} />
            {item.label}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
