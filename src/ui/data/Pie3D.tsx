'use client'

import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { animate, useMotionValue, useMotionValueEvent } from 'motion/react'
import { useCalmMotion } from '../hooks/ui-mode'
import { formatNumber } from '../lib/format'
import { useReveal } from '../hooks/reveal'
import styles from './Pie3D.module.css'

/**
 * Объёмная кольцевая диаграмма (решение 95).
 *
 * Настоящий объём, а не тень под плоским кольцом: у кольца есть толщина, передняя
 * половина показывает внешнюю стенку, задняя — внутреннюю сквозь отверстие. Всё
 * строится проекцией в SVG — без WebGL и новых зависимостей.
 *
 * Движение: при появлении на экране сектора выметаются по кругу; кольцо можно
 * крутить мышью или пальцем — с инерцией; сектор под курсором выдвигается наружу
 * и приподнимается, его значение встаёт в центр. В рабочем режиме и при
 * «уменьшить движение» кольцо сразу стоит собранным и не крутится само.
 */

export type Pie3DTone = 'violet' | 'pink' | 'cyan' | 'orange' | 'warning' | 'danger' | 'success' | 'muted'

export interface Pie3DSlice {
  key: string
  label: string
  value: number
  tone: Pie3DTone
  /** Строка под значением в центре при наведении. */
  detail?: string
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

/** Шаг выборки дуги, радианы: 2° — гладко и дёшево. */
const STEP = Math.PI / 90
const TAU = Math.PI * 2

type Point = [number, number]

interface Geometry {
  cx: number
  cy: number
  outer: number
  inner: number
  /** Сжатие по вертикали — наклон кольца к зрителю. */
  squash: number
  depth: number
}

function at(g: Geometry, angle: number, radius: number, drop: number, shift: Point): Point {
  return [g.cx + radius * Math.cos(angle) + shift[0], g.cy + radius * Math.sin(angle) * g.squash + drop + shift[1]]
}

function arc(from: number, to: number): number[] {
  const angles: number[] = []
  const count = Math.max(2, Math.ceil((to - from) / STEP))
  for (let i = 0; i <= count; i++) angles.push(from + ((to - from) * i) / count)
  return angles
}

function path(points: Point[]): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`).join('') + 'Z'
}

/** Верхняя грань сектора: внешняя дуга туда, внутренняя обратно. */
function topFace(g: Geometry, a0: number, a1: number, shift: Point): string {
  const angles = arc(a0, a1)
  return path([
    ...angles.map((a) => at(g, a, g.outer, 0, shift)),
    ...angles.reverse().map((a) => at(g, a, g.inner, 0, shift)),
  ])
}

/**
 * Стенки сектора по радиусу `radius`, только там, где их видно: внешнюю — на
 * передней половине (sin > 0), внутреннюю — на задней (sin < 0).
 */
function walls(g: Geometry, a0: number, a1: number, radius: number, front: boolean, shift: Point): string[] {
  const runs: number[][] = []
  let run: number[] = []
  for (const a of arc(a0, a1)) {
    const visible = front ? Math.sin(a) > -0.001 : Math.sin(a) < 0.001
    if (visible) run.push(a)
    else if (run.length) {
      runs.push(run)
      run = []
    }
  }
  if (run.length) runs.push(run)
  return runs
    .filter((r) => r.length > 1)
    .map((r) =>
      path([...r.map((a) => at(g, a, radius, 0, shift)), ...r.slice().reverse().map((a) => at(g, a, radius, g.depth, shift))]),
    )
}

/** Торец сектора — видно только у выдвинутого. */
function end(g: Geometry, angle: number, shift: Point): string {
  return path([
    at(g, angle, g.inner, 0, shift),
    at(g, angle, g.outer, 0, shift),
    at(g, angle, g.outer, g.depth, shift),
    at(g, angle, g.inner, g.depth, shift),
  ])
}

export function Pie3D({
  slices,
  label,
  centerLabel,
  centerValue,
  valueSuffix = '',
  size = 260,
  thickness = 0.58,
  spinnable = true,
}: {
  slices: Pie3DSlice[]
  /** Подпись для читалок экрана: что показывает диаграмма. */
  label: string
  /** Подпись под суммой в центре, пока ни один сектор не выбран. */
  centerLabel: string
  /** Своё значение в центре вместо суммы — для диаграммы-доли: «89,1%». */
  centerValue?: string
  /** Приписка к значениям сектора: «%» у долей. */
  valueSuffix?: string
  size?: number
  /** Ширина кольца: доля внутреннего радиуса от внешнего. */
  thickness?: number
  spinnable?: boolean
}) {
  const id = useId().replace(/:/g, '')
  const calm = useCalmMotion()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useReveal(ref)

  const total = slices.reduce((sum, slice) => sum + Math.max(slice.value, 0), 0)
  const [active, setActive] = useState<number | null>(null)

  // Выметание и поворот — значения motion, кадры — через состояние.
  const sweep = useMotionValue(calm ? 1 : 0)
  const spin = useMotionValue(-Math.PI / 2)
  const [frame, setFrame] = useState({ sweep: calm ? 1 : 0, spin: -Math.PI / 2 })
  useMotionValueEvent(sweep, 'change', (value) => setFrame((f) => ({ ...f, sweep: value })))
  useMotionValueEvent(spin, 'change', (value) => setFrame((f) => ({ ...f, spin: value })))

  useEffect(() => {
    if (!inView) return
    if (calm) {
      sweep.set(1)
      return
    }
    const controls = [
      animate(sweep, 1, { duration: 1.3, ease: [0.16, 1, 0.3, 1] }),
      // Кольцо доворачивается, пока выметается: «собирается» вращением.
      animate(spin, -Math.PI / 2 + Math.PI / 3, { duration: 1.6, ease: [0.16, 1, 0.3, 1] }),
    ]
    return () => controls.forEach((c) => c.stop())
  }, [inView, calm, sweep, spin])

  // Вращение мышью или пальцем с инерцией.
  const drag = useRef<{ x: number; t: number; v: number } | null>(null)
  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (!spinnable || calm) return
    event.currentTarget.setPointerCapture(event.pointerId)
    spin.stop()
    drag.current = { x: event.clientX, t: performance.now(), v: 0 }
  }
  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const d = drag.current
    if (!d) return
    const now = performance.now()
    const delta = (event.clientX - d.x) * 0.012
    spin.set(spin.get() + delta)
    d.v = delta / Math.max(now - d.t, 1)
    d.x = event.clientX
    d.t = now
  }
  function onPointerUp() {
    const d = drag.current
    drag.current = null
    if (!d) return
    animate(spin, spin.get() + d.v * 420, { duration: 1.2, ease: [0.16, 1, 0.3, 1] })
  }

  const g: Geometry = {
    cx: size / 2,
    cy: size * 0.42,
    outer: size * 0.44,
    inner: size * 0.44 * thickness,
    squash: 0.52,
    depth: size * 0.1,
  }
  const height = size * 0.42 + size * 0.44 * 0.52 + size * 0.1 + size * 0.06

  // Углы секторов с учётом выметания и поворота.
  let cursor = frame.spin
  const sweepTotal = TAU * frame.sweep
  const parts = slices.map((slice, index) => {
    const span = total > 0 ? (Math.max(slice.value, 0) / total) * sweepTotal : 0
    const a0 = cursor
    cursor += span
    const mid = a0 + span / 2
    const lifted = index === active
    const shift: Point = lifted ? [Math.cos(mid) * size * 0.05, Math.sin(mid) * size * 0.05 * g.squash - size * 0.035] : [0, 0]
    return { slice, index, a0, a1: a0 + span, span, shift, color: TONE_VAR[slice.tone] }
  })
  const visible = parts.filter((part) => part.span > 0.0001)
  const rest = visible.filter((part) => part.index !== active)
  const lifted = visible.find((part) => part.index === active)

  const shown = active !== null ? slices[active] : null
  /** Доля сектора в процентах — показывается в легенде, а не в центре: там ей не хватало места. */
  const shareOf = (value: number) =>
    total > 0 ? `${(Math.round((value / total) * 1000) / 10).toLocaleString('ru-RU')}%` : null

  const drawSlice = (part: (typeof visible)[number], ends: { start: boolean; end: boolean }) => (
    <g key={part.slice.key} className={styles.slice} style={{ color: part.color }}>
      {walls(g, part.a0, part.a1, g.inner, false, part.shift).map((d, i) => (
        <path key={`i${i}`} d={d} className={styles.innerWall} />
      ))}
      {ends.start && <path d={end(g, part.a0, part.shift)} className={styles.endFace} />}
      {ends.end && <path d={end(g, part.a1, part.shift)} className={styles.endFace} />}
      {walls(g, part.a0, part.a1, g.outer, true, part.shift).map((d, i) => (
        <path key={`o${i}`} d={d} className={styles.outerWall} />
      ))}
      <path
        d={topFace(g, part.a0, part.a1, part.shift)}
        className={styles.top}
        onPointerEnter={(event) => {
          // Касание не «наводит»: иначе сектор оставался выдвинутым после тапа.
          if (event.pointerType !== 'touch') setActive(part.index)
        }}
        onPointerLeave={() => setActive((current) => (current === part.index ? null : current))}
      />
      <path d={topFace(g, part.a0, part.a1, part.shift)} fill={`url(#${id}-sheen)`} className={styles.sheen} />
    </g>
  )

  return (
    <div ref={ref} className={styles.root} data-spinnable={spinnable && !calm ? '' : undefined}>
      <div className={styles.stage}>
      <svg
        viewBox={`0 0 ${size} ${height}`}
        className={styles.svg}
        role="img"
        aria-label={`${label}: ${slices.map((s) => `${s.label} — ${formatNumber(s.value)}`).join(', ')}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // Сброс — по уходу со всей диаграммы, а не с грани: выдвинутая грань
        // уезжает из-под курсора, и при быстром уходе её «уход» не приходил —
        // сектор оставался смещённым (бриф v2, 1.2). idle → hover → idle.
        onPointerLeave={() => setActive(null)}
      >
        <defs>
          {/* Блик на верхней грани: свет сверху слева — белым поверх цвета сектора.
              currentColor в градиенте брал бы цвет <defs>, а не сектора. */}
          <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="0.9" y2="1">
            <stop offset="0" stopColor="white" stopOpacity="0.28" />
            <stop offset="0.55" stopColor="white" stopOpacity="0.04" />
            <stop offset="1" stopColor="black" stopOpacity="0.18" />
          </linearGradient>
          <radialGradient id={`${id}-shadow`}>
            <stop offset="0" stopColor="black" stopOpacity="0.55" />
            <stop offset="1" stopColor="black" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Тень на «полу» — кольцо стоит, а не висит. */}
        <ellipse
          cx={g.cx}
          cy={g.cy + g.depth + size * 0.03}
          rx={g.outer * 1.08}
          ry={g.outer * g.squash * 1.1}
          fill={`url(#${id}-shadow)`}
        />

        {total === 0 ? (
          <ellipse cx={g.cx} cy={g.cy} rx={g.outer} ry={g.outer * g.squash} className={styles.empty} />
        ) : (
          <>
            {/*
              Пока сектор выдвинут, у соседей открываются срезы в зазор — им торцы.
              Только эти два: торец в другом месте лёг бы на соседнюю грань.
            */}
            {rest.map((part) => {
              const at = visible.indexOf(part)
              const liftedAt = lifted ? visible.indexOf(lifted) : -1
              const count = visible.length
              return drawSlice(part, {
                start: liftedAt >= 0 && (liftedAt + 1) % count === at,
                end: liftedAt >= 0 && (at + 1) % count === liftedAt,
              })
            })}
            {lifted && drawSlice(lifted, { start: true, end: true })}
          </>
        )}
      </svg>

      </div>

      {/*
        Показание — под кольцом, а не в отверстии: в наклоне отверстие — узкий
        эллипс, и любая надпись там ложилась на грани. Высота строки постоянная —
        при наведении ничего не сдвигается.
      */}
      <div className={styles.readout} aria-live="polite">
        {/* Серый сектор («дефицит») своим цветом не читался бы — у него светлый текст. */}
        <span
          className={styles.readoutValue}
          style={shown && shown.tone !== 'muted' ? { color: TONE_VAR[shown.tone] } : undefined}
        >
          {total === 0 ? 'Нет данных' : shown ? `${formatNumber(shown.value)}${valueSuffix}` : (centerValue ?? formatNumber(total))}
        </span>
        <span className={styles.readoutLabel}>{shown ? shown.label : centerLabel}</span>
      </div>

      <ul className={styles.legend}>
        {slices.map((slice, index) => (
          <li key={slice.key}>
            <button
              type="button"
              className={[styles.legendItem, index === active ? styles.legendActive : ''].filter(Boolean).join(' ')}
              style={{ color: TONE_VAR[slice.tone] }}
              onPointerEnter={(event) => {
                if (event.pointerType !== 'touch') setActive(index)
              }}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              title={slice.detail}
            >
              <span className={styles.swatch} aria-hidden />
              <span className={styles.legendLabel}>{slice.label}</span>
              <span className={styles.legendValue}>
                {formatNumber(slice.value)}
                {valueSuffix}
              </span>
              {/* Доля — у всех подписей сразу: если показывать её только у выбранной,
                  подпись удлинялась и легенда перескакивала на новую строку. */}
              {!valueSuffix && shareOf(slice.value) && (
                <span className={styles.legendShare}>· {shareOf(slice.value)}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
