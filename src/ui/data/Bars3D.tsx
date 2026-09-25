'use client'

import { useEffect, useRef, useState } from 'react'
import { animate, useMotionValue, useMotionValueEvent } from 'motion/react'
import Link from 'next/link'
import { useCalmMotion } from '../hooks/ui-mode'
import { formatNumber } from '../lib/format'
import type { Pie3DTone } from './Pie3D'
import { useReveal } from '../hooks/reveal'
import styles from './Bars3D.module.css'

/**
 * Объёмные столбики (решение 88): у каждой группы — колонка с передней гранью,
 * боковиной и крышкой, сложенная из частей (например, «в работе» снизу и
 * «требует внимания» сверху). Колонки вырастают из пола по очереди; под курсором
 * колонка приподнимается, над ней — подпись с разбором. Проекция в SVG, без WebGL.
 */

export interface Bars3DPart {
  key: string
  label: string
  value: number
  tone: Pie3DTone
}

export interface Bars3DGroup {
  key: string
  label: string
  /** Полное название — в подсказке. */
  title: string
  href?: string
  /** Части снизу вверх. */
  parts: Bars3DPart[]
}

const TONE_VAR: Record<Pie3DTone, string> = {
  violet: 'var(--accent-violet)',
  pink: 'var(--accent-pink)',
  cyan: 'var(--accent-cyan)',
  orange: 'var(--accent-orange)',
  warning: 'var(--status-warning)',
  danger: 'var(--status-danger)',
  success: 'var(--status-success)',
  muted: 'var(--line-strong)',
}

/** Ширина поля по умолчанию; на деле — ширина блока, чтобы текст не сжимался. */
const DEFAULT_WIDTH = 960
const HEIGHT = 300
/** Запас снизу под наклонённые подписи на узком экране. */
const TILT_ROOM = 40
const FLOOR = 250
/** Глубина колонки и её проекция: вправо и вверх. */
const DEPTH = 26
const DX = DEPTH * 0.8
const DY = -DEPTH * 0.55
const TOP_ROOM = 64
/** Длительность роста одной колонки и шаг между ними, доли общего времени. */
const GROW = 0.55
const STAGGER = 0.07

const ease = (t: number) => 1 - Math.pow(1 - t, 3)

function quad(points: Array<[number, number]>): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join('') + 'Z'
}

export function Bars3D({ groups, label, unit }: { groups: Bars3DGroup[]; label: string; unit: [string, string, string] }) {
  const calm = useCalmMotion()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useReveal(ref)
  const grow = useMotionValue(calm ? 1 : 0)
  const [t, setT] = useState(calm ? 1 : 0)
  const [active, setActive] = useState<number | null>(null)
  useMotionValueEvent(grow, 'change', setT)

  // Поле диаграммы — в пикселях блока: на телефоне подписи остаются своего
  // размера, а не сжимаются вместе с рисунком.
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    // Сразу по размеру блока и при смене окна — не только через наблюдатель:
    // в фоновой вкладке он молчит, и поле оставалось бы 960 на телефоне.
    const measure = () => setWidth(Math.max(320, Math.round(element.getBoundingClientRect().width)))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  useEffect(() => {
    if (!inView) return
    if (calm) {
      grow.set(1)
      return
    }
    const controls = animate(grow, 1, { duration: 1.2 + groups.length * 0.08, ease: 'linear' })
    return () => controls.stop()
  }, [inView, calm, grow, groups.length])

  const max = Math.max(1, ...groups.map((group) => group.parts.reduce((sum, part) => sum + part.value, 0)))
  const slot = (width - DX - 16) / Math.max(groups.length, 1)
  const barWidth = Math.max(18, Math.min(64, slot - DX - 14))
  const unitHeight = (FLOOR - TOP_ROOM) / max
  const span = GROW + STAGGER * Math.max(groups.length - 1, 0)
  const gridStep = Math.max(1, Math.ceil(max / 5))
  // Узкое поле (телефон): подписи под колонками наклонены, чтобы не налезали.
  const tiltLabels = slot < 76

  return (
    <div ref={ref} className={styles.root}>
      <svg viewBox={`0 0 ${width} ${HEIGHT + (tiltLabels ? TILT_ROOM : 0)}`} className={styles.svg} role="img" aria-label={label}>
        {/* Пол: параллелограмм с линиями — колонки стоят на плоскости, а не висят. */}
        <path
          d={quad([
            [8, FLOOR],
            [width - DX - 8, FLOOR],
            [width - 8, FLOOR + DY],
            [8 + DX, FLOOR + DY],
          ])}
          className={styles.floor}
        />
        {/* Не больше шести линий сетки: шаг — «круглое» число единиц. */}
        {Array.from({ length: Math.floor(max / gridStep) + 1 }, (_, i) => i * gridStep).map((level) => (
          <g key={level} className={styles.grid}>
            <line x1={8 + DX} y1={FLOOR + DY - level * unitHeight} x2={width - 8} y2={FLOOR + DY - level * unitHeight} />
            {level > 0 && (
              <text x={width - 6} y={FLOOR + DY - level * unitHeight - 3} textAnchor="end" className={styles.axisText}>
                {level}
              </text>
            )}
          </g>
        ))}

        {groups.map((group, index) => {
          const local = Math.min(Math.max((t * span - index * STAGGER) / GROW, 0), 1)
          const k = ease(local)
          const lifted = index === active
          const x = 16 + index * slot + (slot - DX - barWidth) / 2
          const lift = lifted ? -8 : 0
          let base = FLOOR + lift
          const sum = group.parts.reduce((s, p) => s + p.value, 0)
          const faces = group.parts
            .filter((part) => part.value > 0)
            .map((part, partIndex, list) => {
              const h = part.value * unitHeight * k
              const top = base - h
              const color = TONE_VAR[part.tone]
              const isTop = partIndex === list.length - 1
              const shapes = (
                <g key={part.key} style={{ color }}>
                  <rect x={x} y={top} width={barWidth} height={Math.max(h, 0)} className={styles.front} />
                  <path
                    d={quad([
                      [x + barWidth, base],
                      [x + barWidth, top],
                      [x + barWidth + DX, top + DY],
                      [x + barWidth + DX, base + DY],
                    ])}
                    className={styles.side}
                  />
                  {isTop && (
                    <path
                      d={quad([
                        [x, top],
                        [x + barWidth, top],
                        [x + barWidth + DX, top + DY],
                        [x + DX, top + DY],
                      ])}
                      className={styles.cap}
                    />
                  )}
                </g>
              )
              base = top
              return shapes
            })
          const body = (
            <g
              className={[styles.bar, lifted ? styles.lifted : ''].filter(Boolean).join(' ')}
              onPointerEnter={() => setActive(index)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
            >
              {/* Прозрачная мишень во всю высоту: навести можно и на низкую колонку. */}
              <rect x={x - 6} y={TOP_ROOM - 20} width={barWidth + DX + 12} height={FLOOR - TOP_ROOM + 40} fill="transparent" />
              {faces}
              <text
                x={x + barWidth / 2}
                y={FLOOR + 22}
                textAnchor={tiltLabels ? 'end' : 'middle'}
                transform={tiltLabels ? `rotate(-35 ${x + barWidth / 2} ${FLOOR + 22})` : undefined}
                className={styles.label}
              >
                {group.label}
              </text>
              {local > 0.98 && (
                <text x={x + barWidth / 2 + DX / 2} y={base + DY - 8} textAnchor="middle" className={styles.value}>
                  {formatNumber(sum)}
                </text>
              )}
            </g>
          )
          return group.href ? (
            <Link key={group.key} href={group.href} aria-label={`${group.title}: ${formatNumber(sum)}`}>
              {body}
            </Link>
          ) : (
            <g key={group.key}>{body}</g>
          )
        })}
      </svg>

      {/* Разбор колонки под курсором — HTML над SVG, чтобы текст не масштабировался. */}
      {active !== null && groups[active] && (
        <div
          className={styles.tip}
          style={{ left: `${((16 + active * slot + slot / 2) / width) * 100}%` }}
          role="status"
        >
          <strong className={styles.tipTitle}>{groups[active].title}</strong>
          {groups[active].parts.map((part) => (
            <span key={part.key} className={styles.tipRow} style={{ color: TONE_VAR[part.tone] }}>
              <span className={styles.tipDot} aria-hidden />
              <span className={styles.tipLabel}>{part.label}</span>
              <span className={styles.tipValue}>{formatNumber(part.value)}</span>
            </span>
          ))}
        </div>
      )}

      <p className={styles.legend}>
        {groups[0]?.parts.map((part) => (
          <span key={part.key} className={styles.legendItem} style={{ color: TONE_VAR[part.tone] }}>
            <span className={styles.tipDot} aria-hidden />
            <span className={styles.tipLabel}>{part.label}</span>
          </span>
        ))}
        <span className={styles.legendNote}>высота — {unit[2]}</span>
      </p>
    </div>
  )
}
