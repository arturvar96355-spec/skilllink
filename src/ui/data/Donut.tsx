'use client'

import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useCalmMotion } from '../hooks/ui-mode'
import { useReveal } from '../hooks/reveal'
import { formatNumber } from '../lib/format'
import { donutArcs, nextSector, ringSectorPath, sectorOffset, sharePercent } from './donut-geometry'
import styles from './Donut.module.css'

/**
 * Плоское кольцо долей (решение 196, по образцу Bklit Pie/Donut).
 *
 * Сектора различаются не только цветом: основная доля — сплошной заливкой
 * своего тона, остальные — штриховкой или светлотой того же тона. Так кольцо
 * читается и без цвета (дальтоники, печать в ч/б), а акцентный цвет остаётся
 * сигналом, а не раскраской.
 *
 * В отверстии — крупное число и подпись; наведение, фокус с клавиатуры или
 * касание выбирают сектор: он выдвигается наружу, соседи приглушаются, в центре
 * его значение и название. Значения всех секторов всегда видны в подписях под
 * кольцом — наведение ничего не прячет.
 *
 * Появление — одно: дуга дорисовывается по часовой стрелке от «12 часов»
 * (~600 мс), после того как блок главной закончил свою сборку (решение 194).
 * В рабочем режиме и при «уменьшить движение» кольцо сразу стоит целиком.
 */

export type DonutTone = 'violet' | 'pink' | 'cyan' | 'orange' | 'warning' | 'danger' | 'success' | 'muted'

/**
 * Заливка сектора: `solid` — основная доля; `soft` — тот же тон светлее;
 * штриховки — `diagonal`, `vertical`, `cross` (сетка), `dots` (точки).
 */
export type DonutTexture = 'solid' | 'soft' | 'diagonal' | 'vertical' | 'cross' | 'dots'

export interface DonutSlice {
  key: string
  label: string
  value: number
  tone: DonutTone
  /** Не задана — первая доля сплошная, остальные штрихуются по очереди. */
  texture?: DonutTexture
  /** Пояснение в подсказке у подписи. */
  detail?: string
}

const TONE_VAR: Record<DonutTone, string> = {
  violet: 'var(--accent-violet)',
  pink: 'var(--accent-pink)',
  cyan: 'var(--accent-cyan)',
  orange: 'var(--accent-orange)',
  warning: 'var(--status-warning)',
  danger: 'var(--status-danger)',
  success: 'var(--status-success)',
  // Серый штрих «дефицита» — третьим цветом текста: линия границы в штрихе не видна.
  muted: 'var(--text-tertiary)',
}

const FALLBACK_TEXTURES: DonutTexture[] = ['diagonal', 'vertical', 'cross', 'dots', 'soft']

function textureOf(slice: DonutSlice, index: number): DonutTexture {
  return slice.texture ?? (index === 0 ? 'solid' : FALLBACK_TEXTURES[(index - 1) % FALLBACK_TEXTURES.length]!)
}

const PATTERNED = new Set<DonutTexture>(['diagonal', 'vertical', 'cross', 'dots'])

/** Рисунок в единицах viewBox 0..200: центр, запас на выдвижение, зазор. */
const VIEW = 200
const C = VIEW / 2
const LIFT = 6
const OUTER = C - LIFT - 1
const PAD = 0.035

/** Сколько ждать сборку блока, прежде чем рисовать всё равно, мс. */
const ASSEMBLY_WAIT_CAP = 2500

type Phase = 'hidden' | 'drawing' | 'done'

/**
 * Дождаться, пока доиграют анимации предков (сборка главной, решение 194):
 * кольцо, дорисованное на лету летящего блока, не видно. Бесконечные анимации
 * не ждём; на всё — не дольше `ASSEMBLY_WAIT_CAP`.
 */
function afterAncestorsSettle(element: Element): Promise<void> {
  if (typeof document === 'undefined' || typeof document.getAnimations !== 'function') return Promise.resolve()
  const pending = document.getAnimations().filter((animation) => {
    const target = (animation.effect as KeyframeEffect | null)?.target
    if (!target || target === element || !target.contains(element)) return false
    if (animation.playState === 'finished') return false
    return animation.effect?.getComputedTiming().endTime !== Infinity
  })
  if (pending.length === 0) return Promise.resolve()
  return Promise.race([
    Promise.allSettled(pending.map((animation) => animation.finished)).then(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, ASSEMBLY_WAIT_CAP)),
  ])
}

export function Donut({
  slices,
  label,
  centerLabel,
  centerValue,
  valueSuffix = '',
  size = 260,
  thickness = 0.62,
}: {
  slices: DonutSlice[]
  /** Что показывает кольцо — для читалок экрана. */
  label: string
  /** Подпись под числом в центре, пока ни один сектор не выбран. */
  centerLabel: string
  /** Своё число в центре вместо суммы — для кольца-доли: «89,1%». */
  centerValue?: string
  /** Приписка к значениям секторов: «%» у долей. */
  valueSuffix?: string
  /** Наибольший диаметр, px; на узком экране кольцо сжимается. */
  size?: number
  /** Внутренний радиус как доля внешнего. */
  thickness?: number
}) {
  const id = useId().replace(/:/g, '')
  const calm = useCalmMotion()
  const rootRef = useRef<HTMLDivElement>(null)
  const inView = useReveal(rootRef)

  const [phase, setPhase] = useState<Phase>('hidden')
  const [active, setActive] = useState<number | null>(null)
  /** Сектор выбран с клавиатуры — ему обводка вместо системной рамки. */
  const [keyboard, setKeyboard] = useState(false)
  /** Сектор, на котором стоит табуляция (один вход в кольцо, дальше стрелки). */
  const [rover, setRover] = useState(0)
  const hitRefs = useRef<(SVGPathElement | null)[]>([])
  /** Выбор касанием держится до касания мимо кольца. */
  const touchPinned = useRef(false)

  // Появление: спокойный режим — сразу целиком; иначе — когда кольцо на экране
  // и блок вокруг него собрался.
  useEffect(() => {
    if (calm) {
      setPhase('done')
      return
    }
    if (!inView || phase !== 'hidden') return
    const element = rootRef.current
    if (!element) return
    let cancelled = false
    void afterAncestorsSettle(element).then(() => {
      if (!cancelled) setPhase('drawing')
    })
    return () => {
      cancelled = true
    }
  }, [calm, inView, phase])

  // Запасной конец дорисовки: `animationend` не приходит, если вкладка в фоне.
  useEffect(() => {
    if (phase !== 'drawing') return
    const timer = window.setTimeout(() => setPhase('done'), 900)
    return () => window.clearTimeout(timer)
  }, [phase])

  // Касание мимо кольца снимает выбор, сделанный касанием.
  useEffect(() => {
    if (active === null || !touchPinned.current) return
    const onDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      touchPinned.current = false
      setActive(null)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [active])

  const values = slices.map((slice) => slice.value)
  const total = values.reduce((sum, value) => sum + Math.max(value, 0), 0)
  const arcs = donutArcs(values, PAD)
  const inner = OUTER * thickness
  const shown = active !== null ? slices[active] : null

  const valueText = (slice: DonutSlice) => `${formatNumber(slice.value)}${valueSuffix}`
  const sliceAria = (slice: DonutSlice) => {
    const share = !valueSuffix ? sharePercent(slice.value, total) : null
    return `${slice.label}: ${valueText(slice)}${share ? `, ${share}` : ''}`
  }

  // Узоры — по одному на пару «тон + штриховка», только те, что нужны.
  const patterns = new Map<string, { tone: DonutTone; texture: DonutTexture }>()
  slices.forEach((slice, index) => {
    const texture = textureOf(slice, index)
    if (PATTERNED.has(texture)) patterns.set(`${slice.tone}-${texture}`, { tone: slice.tone, texture })
  })
  const patternId = (tone: DonutTone, texture: DonutTexture) => `${id}-${tone}-${texture}`

  function choose(index: number | null) {
    setActive(index)
    if (index === null) setKeyboard(false)
  }

  function onHitPointerEnter(event: ReactPointerEvent, index: number) {
    if (event.pointerType === 'touch') return
    touchPinned.current = false
    choose(index)
  }

  function onHitPointerUp(event: ReactPointerEvent, index: number) {
    if (event.pointerType !== 'touch') return
    // Второе касание того же сектора снимает выбор.
    const next = active === index && touchPinned.current ? null : index
    touchPinned.current = next !== null
    setKeyboard(false)
    setActive(next)
  }

  function onHitKeyDown(event: KeyboardEvent<SVGPathElement>, position: number) {
    if (event.key === 'Escape') {
      choose(null)
      return
    }
    const target = nextSector(position, arcs.length, event.key)
    if (target === null) return
    event.preventDefault()
    setRover(target)
    hitRefs.current[target]?.focus()
  }

  const stageStyle = { '--donut-size': `${size}px`, '--donut-hole': `${((inner * 2) / VIEW) * 100}%` } as CSSProperties

  return (
    <div ref={rootRef} className={styles.root} data-phase={phase} data-large={size >= 280 ? '' : undefined}>
      <div className={styles.stage} style={stageStyle}>
        <svg
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          className={styles.svg}
          role="group"
          aria-label={`${label}: ${slices.map((slice) => `${slice.label} — ${valueText(slice)}`).join(', ')}`}
          onPointerLeave={(event) => {
            if (event.pointerType !== 'touch' && !keyboard) choose(null)
          }}
        >
          <defs>
            {[...patterns.values()].map(({ tone, texture }) => (
              <pattern
                key={`${tone}-${texture}`}
                id={patternId(tone, texture)}
                width={texture === 'dots' ? 5 : 6}
                height={texture === 'dots' ? 5 : 6}
                patternUnits="userSpaceOnUse"
                patternTransform={texture === 'diagonal' || texture === 'cross' ? 'rotate(45)' : undefined}
              >
                {texture === 'dots' ? (
                  <circle cx="2.5" cy="2.5" r="1.1" style={{ fill: TONE_VAR[tone] }} />
                ) : (
                  <>
                    <line x1="1" y1="0" x2="1" y2="6" className={styles.hatch} style={{ stroke: TONE_VAR[tone] }} />
                    {texture === 'cross' && (
                      <line x1="0" y1="1" x2="6" y2="1" className={styles.hatch} style={{ stroke: TONE_VAR[tone] }} />
                    )}
                  </>
                )}
              </pattern>
            ))}
            {phase !== 'done' && (
              // Дорисовка: толстая дуга-маска открывает кольцо по часовой стрелке.
              <mask id={`${id}-draw`} className={styles.drawMask} maskUnits="userSpaceOnUse" x="0" y="0" width={VIEW} height={VIEW}>
                <circle
                  cx={C}
                  cy={C}
                  r={(inner - 2 + C) / 2}
                  pathLength={1}
                  transform={`rotate(-90 ${C} ${C})`}
                  className={phase === 'drawing' ? styles.drawArc : styles.drawArcHidden}
                  style={{ strokeWidth: C - inner + 2 }}
                  onAnimationEnd={() => setPhase('done')}
                />
              </mask>
            )}
          </defs>

          <g mask={phase !== 'done' ? `url(#${id}-draw)` : undefined}>
            <circle
              cx={C}
              cy={C}
              r={(OUTER + inner) / 2}
              className={total > 0 ? styles.track : styles.trackEmpty}
              style={{ strokeWidth: OUTER - inner }}
            />
            {arcs.map((arc) => {
              const slice = slices[arc.index]!
              const texture = textureOf(slice, arc.index)
              const d = ringSectorPath(C, C, inner, OUTER, arc.a0, arc.a1)
              const lifted = active === arc.index
              const shift = lifted ? sectorOffset(arc.mid, LIFT) : { x: 0, y: 0 }
              return (
                <g
                  key={slice.key}
                  className={styles.slice}
                  data-active={lifted ? '' : undefined}
                  data-dim={active !== null && !lifted ? '' : undefined}
                  data-focus={lifted && keyboard ? '' : undefined}
                  style={{ color: TONE_VAR[slice.tone], transform: `translate(${shift.x}px, ${shift.y}px)` }}
                >
                  <path d={d} fillRule="evenodd" className={styles[`fill_${texture}`]} />
                  {PATTERNED.has(texture) && (
                    <path d={d} fillRule="evenodd" fill={`url(#${patternId(slice.tone, texture)})`} className={styles.pattern} />
                  )}
                </g>
              )
            })}
          </g>

          {/*
            Наведение и фокус — по неподвижным зонам на месте секторов: выдвинутый
            сектор уезжает из-под курсора, и зона на нём самом заставила бы его
            дрожать у края. Одна остановка табуляции на кольцо, дальше — стрелки.
          */}
          {arcs.map((arc, position) => {
            const slice = slices[arc.index]!
            return (
              <path
                key={`hit-${slice.key}`}
                ref={(node) => {
                  hitRefs.current[position] = node
                }}
                d={ringSectorPath(C, C, inner, OUTER + LIFT, arc.a0, arc.a1)}
                fillRule="evenodd"
                className={styles.hit}
                role="img"
                aria-label={sliceAria(slice)}
                tabIndex={position === Math.min(rover, arcs.length - 1) ? 0 : -1}
                onPointerEnter={(event) => onHitPointerEnter(event, arc.index)}
                onPointerUp={(event) => onHitPointerUp(event, arc.index)}
                onFocus={(event) => {
                  setRover(position)
                  setKeyboard(event.currentTarget.matches(':focus-visible'))
                  setActive(arc.index)
                }}
                onBlur={(event) => {
                  const next = event.relatedTarget as Element | null
                  if (!next || !hitRefs.current.includes(next as SVGPathElement)) choose(null)
                }}
                onKeyDown={(event) => onHitKeyDown(event, position)}
              />
            )
          })}
        </svg>

        {/* Число и подпись в отверстии; для читалок то же сказано в подписи кольца. */}
        <div className={styles.center} aria-hidden>
          <span
            className={styles.centerValue}
            style={shown && shown.tone !== 'muted' ? { color: TONE_VAR[shown.tone] } : undefined}
          >
            {total === 0 ? 'Нет данных' : shown ? valueText(shown) : (centerValue ?? formatNumber(total))}
          </span>
          <span className={styles.centerLabel}>{shown ? shown.label : centerLabel}</span>
        </div>
      </div>

      <ul className={styles.legend}>
        {slices.map((slice, index) => {
          const texture = textureOf(slice, index)
          const share = !valueSuffix ? sharePercent(slice.value, total) : null
          return (
            <li
              key={slice.key}
              className={styles.legendItem}
              data-active={index === active ? '' : undefined}
              style={{ color: TONE_VAR[slice.tone] }}
              title={slice.detail}
              onPointerEnter={(event) => {
                if (event.pointerType === 'touch' || slice.value <= 0) return
                touchPinned.current = false
                choose(index)
              }}
              onPointerLeave={(event) => {
                if (event.pointerType !== 'touch' && !touchPinned.current) choose(null)
              }}
              onPointerUp={(event) => {
                if (slice.value > 0) onHitPointerUp(event, index)
              }}
            >
              <svg className={styles.swatch} viewBox="0 0 12 12" aria-hidden>
                <rect width="12" height="12" rx="3" className={styles[`fill_${texture}`]} />
                {PATTERNED.has(texture) && (
                  <rect width="12" height="12" rx="3" fill={`url(#${patternId(slice.tone, texture)})`} />
                )}
              </svg>
              <span className={styles.legendLabel}>{slice.label}</span>
              <span className={styles.legendValue}>{valueText(slice)}</span>
              {/* Доля — у всех подписей сразу, чтобы строка не прыгала при наведении. */}
              {share && <span className={styles.legendShare}>· {share}</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
