'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { motion } from 'motion/react'
import { useCalmMotion } from '../hooks/ui-mode'
import { RUSSIA_PATH, RUSSIA_VIEWBOX, projectRussia } from './russia-map'
import styles from './RussiaMap.module.css'

/**
 * Карта России (решение 79; вторая версия — решение 123, бриф v2 2.1).
 *
 * Настоящая география (Natural Earth, проекция Альберса) в технологичном виде:
 * тёмный материк с тонким неоновым контуром и сеткой параллелей и меридианов
 * внутри, вузы — светящимися точками (ярче — где связки в работе). От «центра»
 * (`hub`, для главной — Москва, ИТ-Школа РТК) к вузам идут дуги-связи; по ним
 * по очереди, а не все разом, пробегает световой импульс. Наведение на вуз
 * зажигает его дугу и показывает подсказку, щелчок — страница вуза.
 * В рабочем режиме и при «уменьшить движение» — без импульсов и пульсации.
 */
export interface MapPoint {
  key: string
  label: string
  lat: number
  lon: number
  value: number
  detail: string
  href: string
  /** Есть связки в работе — точка ярче и с дугой от центра. */
  active?: boolean
}

export interface MapHub {
  label: string
  lat: number
  lon: number
}

/** Сетка: параллели каждые 10°, меридианы каждые 20° — в пределах России. */
function graticule(): string {
  const lines: string[] = []
  const line = (points: Array<[number, number]>) => {
    const projected = points.map(([lat, lon]) => projectRussia(lat, lon))
    lines.push(projected.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(''))
  }
  for (let lat = 45; lat <= 75; lat += 10) {
    line(Array.from({ length: 41 }, (_, i) => [lat, 20 + i * 4.5] as [number, number]))
  }
  for (let lon = 30; lon <= 190; lon += 20) {
    line(Array.from({ length: 21 }, (_, i) => [40 + i * 1.8, lon] as [number, number]))
  }
  return lines.join('')
}

const GRID = graticule()

/** Дуга от центра к точке: изгиб вверх, пропорциональный длине — как маршрут. */
function arc(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const mx = (from.x + to.x) / 2
  const my = (from.y + to.y) / 2
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  return `M${from.x.toFixed(1)} ${from.y.toFixed(1)}Q${mx.toFixed(1)} ${(my - length * 0.28).toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`
}

/** Кегль подписи в единицах поля (как в CSS) и примерная ширина знака. */
const LABEL_SIZE = 22
/** С запасом: кириллица полужирная и с обводкой шире латиницы. */
const CHAR_WIDTH = LABEL_SIZE * 0.68
/** Длиннее подпись на карте не бывает: полное имя — в подсказке. */
const LABEL_MAX_CHARS = 16

interface Box {
  x1: number
  y1: number
  x2: number
  y2: number
}

interface LabelSpot {
  x: number
  y: number
  anchor: 'start' | 'end' | 'middle'
  text: string
}

const overlaps = (a: Box, b: Box) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2

/**
 * Раскладка подписей (решение 130): близкие вузы (Москва и Петербург, тестовые
 * записи в одном городе) подписывались поверх друг друга. Подпись пробует встать
 * справа, слева, сверху и снизу от точки — туда, где не задевает уже поставленные
 * подписи и чужие точки. Важные точки (со связками, с большим числом) ставятся
 * первыми. Не нашлось места — точка без подписи: имя в подсказке при наведении.
 */
function placeLabels(points: Array<{ key: string; label: string; x: number; y: number; r: number; weight: number }>) {
  const dots: Box[] = points.map((p) => ({ x1: p.x - p.r, y1: p.y - p.r, x2: p.x + p.r, y2: p.y + p.r }))
  const taken: Box[] = []
  const spots = new Map<string, LabelSpot>()
  for (const point of [...points].sort((a, b) => b.weight - a.weight)) {
    const text = point.label.length > LABEL_MAX_CHARS ? `${point.label.slice(0, LABEL_MAX_CHARS - 1)}…` : point.label
    const width = text.length * CHAR_WIDTH + 8
    const gap = point.r + 6
    const candidates: Array<LabelSpot & { box: Box }> = [
      { x: point.x + gap, y: point.y + 7, anchor: 'start', text, box: { x1: point.x + gap, y1: point.y - 17, x2: point.x + gap + width, y2: point.y + 14 } },
      { x: point.x - gap, y: point.y + 7, anchor: 'end', text, box: { x1: point.x - gap - width, y1: point.y - 17, x2: point.x - gap, y2: point.y + 14 } },
      { x: point.x, y: point.y - gap - 4, anchor: 'middle', text, box: { x1: point.x - width / 2, y1: point.y - gap - 26, x2: point.x + width / 2, y2: point.y - gap + 2 } },
      { x: point.x, y: point.y + gap + 18, anchor: 'middle', text, box: { x1: point.x - width / 2, y1: point.y + gap - 2, x2: point.x + width / 2, y2: point.y + gap + 26 } },
    ]
    const own = dots[points.indexOf(point)]
    const spot = candidates.find(
      (candidate) =>
        // Подпись целиком в поле карты: у края она обрезалась.
        candidate.box.x1 >= 0 &&
        candidate.box.x2 <= RUSSIA_VIEWBOX.width &&
        candidate.box.y1 >= 0 &&
        candidate.box.y2 <= RUSSIA_VIEWBOX.height &&
        !taken.some((box) => overlaps(box, candidate.box)) &&
        !dots.some((box) => box !== own && overlaps(box, candidate.box)),
    )
    if (!spot) continue
    taken.push(spot.box)
    spots.set(point.key, { x: spot.x, y: spot.y, anchor: spot.anchor, text: spot.text })
  }
  return spots
}

export function RussiaMap({ points, label, hub }: { points: MapPoint[]; label: string; hub?: MapHub }) {
  const reduced = useCalmMotion()
  const id = useId().replace(/:/g, '')
  const [hovered, setHovered] = useState<string | null>(null)
  const max = Math.max(1, ...points.map((point) => point.value))
  const placed = points.map((point) => ({ ...point, ...projectRussia(point.lat, point.lon) }))
  const center = hub ? { ...hub, ...projectRussia(hub.lat, hub.lon) } : null
  const links = center ? placed.filter((point) => point.active !== false && Math.hypot(point.x - center.x, point.y - center.y) > 8) : []
  const active = placed.find((point) => point.key === hovered) ?? null
  const radius = (value: number) => 5 + 8 * Math.sqrt(value / max)
  const labels = placeLabels(
    placed.map((point) => ({
      key: point.key,
      label: point.label,
      x: point.x,
      y: point.y,
      r: radius(point.value) * 0.62,
      weight: (point.active === false ? 0 : 1000) + point.value,
    })),
  )

  return (
    <figure className={styles.root} aria-label={label}>
      <div className={styles.map}>
        <svg viewBox={`0 0 ${RUSSIA_VIEWBOX.width} ${RUSSIA_VIEWBOX.height}`} className={styles.svg} preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id={`${id}-land`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className={styles.landTop} />
              <stop offset="1" className={styles.landBottom} />
            </linearGradient>
            <clipPath id={`${id}-clip`}>
              <path d={RUSSIA_PATH} />
            </clipPath>
            {/* Неоновое свечение: размытая копия под чёткой линией. */}
            <filter id={`${id}-glow`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <radialGradient id={`${id}-dot`}>
              <stop offset="0" className={styles.dotCore} />
              <stop offset="0.45" className={styles.dotMid} />
              <stop offset="1" className={styles.dotEdge} />
            </radialGradient>
          </defs>

          {/* Материк: глубина градиентом, сетка внутри, неоновый контур. */}
          <path d={RUSSIA_PATH} fill={`url(#${id}-land)`} />
          <path d={GRID} className={styles.grid} clipPath={`url(#${id}-clip)`} />
          <path d={RUSSIA_PATH} className={styles.coast} filter={`url(#${id}-glow)`} />

          {/* Связи центра с вузами: тонкие дуги, импульс — по одной за раз. */}
          {center &&
            links.map((point, index) => {
              const d = arc(center, point)
              const lit = hovered === point.key
              return (
                <g key={`link-${point.key}`} className={lit ? styles.linkLit : styles.link}>
                  <path d={d} className={styles.linkLine} />
                  {!reduced && (
                    <path
                      d={d}
                      className={styles.linkPulse}
                      pathLength={1}
                      style={{ animationDelay: `${index * 1.6}s`, animationDuration: `${Math.max(links.length, 3) * 1.6}s` }}
                    />
                  )}
                </g>
              )
            })}

          {center && (
            <g className={styles.hub}>
              <circle cx={center.x} cy={center.y} r={16} className={styles.hubHalo} />
              <circle cx={center.x} cy={center.y} r={6} className={styles.hubCore} />
            </g>
          )}

          {placed.map((point, index) => {
            const r = radius(point.value)
            const dim = point.active === false
            const spot = labels.get(point.key)
            return (
              <Link
                key={point.key}
                href={point.href}
                aria-label={`${point.label}: ${point.detail}`}
                onPointerEnter={() => setHovered(point.key)}
                onPointerLeave={() => setHovered(null)}
                onFocus={() => setHovered(point.key)}
                onBlur={() => setHovered(null)}
                className={[styles.point, dim ? styles.pointDim : '', hovered === point.key ? styles.pointLit : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                {!reduced && !dim && (
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={r}
                    className={styles.pulse}
                    style={{ animationDelay: `${index * 0.9}s` }}
                  />
                )}
                <circle cx={point.x} cy={point.y} r={r * 2.4} fill={`url(#${id}-dot)`} className={styles.halo} />
                <motion.circle
                  cx={point.x}
                  cy={point.y}
                  r={r * 0.62}
                  className={styles.dot}
                  initial={reduced ? false : { scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: reduced ? 0 : 0.3 + index * 0.08, type: 'spring', stiffness: 260, damping: 18 }}
                  style={{ transformOrigin: `${point.x}px ${point.y}px`, transformBox: 'view-box' }}
                />
                {spot && (
                  <text x={spot.x} y={spot.y} textAnchor={spot.anchor} className={styles.label}>
                    {spot.text}
                  </text>
                )}
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
