'use client'

import { useState } from 'react'
import Link from 'next/link'
import { motion } from 'motion/react'
import { useCalmMotion } from '../hooks/ui-mode'
import { RUSSIA_PATH, RUSSIA_VIEWBOX, projectRussia } from './russia-map'
import styles from './RussiaMap.module.css'

/**
 * Карта России с точками (решение 79, по образцу Bklit Choropleth и карты
 * New Zealanderlivery Service).
 *
 * Точка — объект в своём городе, размер — величина (у вузов — число связок).
 * Точки появляются по очереди и мягко пульсируют; наведение или фокус —
 * подсказка, щелчок — страница объекта. Под картой те же точки списком —
 * для тех, кто карту не видит.
 */
export interface MapPoint {
  key: string
  label: string
  lat: number
  lon: number
  value: number
  detail: string
  href: string
}

export function RussiaMap({ points, label }: { points: MapPoint[]; label: string }) {
  const reduced = useCalmMotion()
  const [hovered, setHovered] = useState<string | null>(null)
  const max = Math.max(1, ...points.map((point) => point.value))
  const placed = points.map((point) => ({ ...point, ...projectRussia(point.lat, point.lon) }))
  const active = placed.find((point) => point.key === hovered) ?? null

  return (
    <figure className={styles.root} aria-label={label}>
      <div className={styles.map}>
        <svg viewBox={`0 0 ${RUSSIA_VIEWBOX.width} ${RUSSIA_VIEWBOX.height}`} className={styles.svg}>
          <path d={RUSSIA_PATH} className={styles.land} />
          {placed.map((point, index) => {
            const r = 6 + 10 * Math.sqrt(point.value / max)
            return (
              <Link
                key={point.key}
                href={point.href}
                aria-label={`${point.label}: ${point.detail}`}
                onPointerEnter={() => setHovered(point.key)}
                onPointerLeave={() => setHovered(null)}
                onFocus={() => setHovered(point.key)}
                onBlur={() => setHovered(null)}
                className={styles.point}
              >
                {!reduced && (
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={r}
                    className={styles.pulse}
                    style={{ animationDelay: `${index * 0.35}s` }}
                  />
                )}
                <motion.circle
                  cx={point.x}
                  cy={point.y}
                  r={r}
                  className={styles.dot}
                  initial={reduced ? false : { scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: reduced ? 0 : 0.3 + index * 0.08, type: 'spring', stiffness: 260, damping: 18 }}
                  style={{ transformOrigin: `${point.x}px ${point.y}px`, transformBox: 'view-box' }}
                />
                <text x={point.x + r + 6} y={point.y + 5} className={styles.label}>
                  {point.label}
                </text>
              </Link>
            )
          })}
        </svg>
        {active && (
          <div
            className={styles.tooltip}
            role="tooltip"
            style={{
              left: `${(active.x / RUSSIA_VIEWBOX.width) * 100}%`,
              top: `${(active.y / RUSSIA_VIEWBOX.height) * 100}%`,
            }}
          >
            <span className={styles.tooltipTitle}>{active.label}</span>
            <span className={styles.tooltipText}>{active.detail}</span>
          </div>
        )}
      </div>
    </figure>
  )
}
