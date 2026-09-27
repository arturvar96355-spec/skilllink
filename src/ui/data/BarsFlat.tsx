'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { motion } from 'motion/react'
import { useCalmMotion } from '../hooks/ui-mode'
import { useReveal } from '../hooks/reveal'
import { formatNumber } from '../lib/format'
import type { Bars3DGroup, Bars3DPart } from './Bars3D'
import styles from './BarsFlat.module.css'

/**
 * Плоские столбики в духе Bklit (решение 198) — замена объёмных Bars3D на главной.
 * У каждой группы (вуза) — пара столбиков рядом, а не колонка из частей:
 * так видно и сколько связок идёт спокойно, и сколько требует внимания, без
 * вычитания в уме.
 *
 * Два вида на выбор владельца (`variant`):
 * - `grouped` — пара со скруглённым верхом и зазором, тёмный нейтральный тон
 *   для спокойных и приглушённый сигнальный — для требующих внимания;
 * - `indicator` — пара вплотную: первый столбик — градиент, уходящий в фон,
 *   второй — штриховка по диагонали; при наведении по столбикам поднимается
 *   черта-указатель до их верха.
 *
 * Число над каждым столбиком видно всегда; наведение или фокус с клавиатуры
 * приглушают остальные вузы и показывают подсказку с полным названием.
 * Столбики вырастают один раз, когда блок дошёл до экрана; при «уменьшить
 * движение» и в рабочем режиме — сразу в конечном виде.
 */
export type BarsFlatVariant = 'grouped' | 'indicator'

type Series = 'base' | 'signal'

/** Сигнальные части (требуют внимания) — тёплым тоном, остальные — нейтральным. */
const seriesOf = (part: Bars3DPart): Series => (part.tone === 'danger' || part.tone === 'warning' ? 'signal' : 'base')

const DEFAULT_WIDTH = 960
const HEIGHT = 262
/** Линия пола и место сверху под числа над столбиками. */
const FLOOR = 218
const TOP = 34
/** Запас снизу под наклонённые подписи на узком экране. */
const TILT_ROOM = 44
const PAD = 8

/** «Круглый» шаг сетки: не больше пяти линий над полом. */
function gridStep(max: number): number {
  for (const base of [1, 2, 5, 10, 20, 50, 100, 200, 500]) if (max / base <= 5) return base
  return Math.ceil(max / 5)
}

/** Столбик со скруглённым верхом и прямым низом — стоит на полу. */
function roundedTop(x: number, top: number, width: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, width / 2, FLOOR - top))
  return [
    `M${x.toFixed(1)} ${FLOOR}`,
    `V${(top + r).toFixed(1)}`,
    `Q${x.toFixed(1)} ${top.toFixed(1)} ${(x + r).toFixed(1)} ${top.toFixed(1)}`,
    `H${(x + width - r).toFixed(1)}`,
    `Q${(x + width).toFixed(1)} ${top.toFixed(1)} ${(x + width).toFixed(1)} ${(top + r).toFixed(1)}`,
    `V${FLOOR}Z`,
  ].join('')
}

/** Строка для чтения вслух и подсказки: «МТУСИ: идут по плану — 3, требуют внимания — 2». */
function describe(group: Bars3DGroup): string {
  return `${group.title}: ${group.parts.map((part) => `${part.label.toLowerCase()} — ${formatNumber(part.value)}`).join(', ')}`
}

export function BarsFlat({
  groups,
  label,
  variant = 'grouped',
}: {
  groups: Bars3DGroup[]
  label: string
  variant?: BarsFlatVariant
  /** Как у Bars3D — чтобы замена была одной строкой; единицы видны в подписях частей. */
  unit?: [string, string, string]
}) {
  const calm = useCalmMotion()
  const id = useId().replace(/:/g, '')
  const ref = useRef<HTMLDivElement>(null)
  const inView = useReveal(ref)
  const [active, setActive] = useState<number | null>(null)

  // Поле — в пикселях блока (единица viewBox = пиксель): подписи не сжимаются на телефоне.
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setWidth(Math.max(300, Math.round(element.getBoundingClientRect().width)))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  const grouped = variant === 'grouped'
  const count = Math.max(groups.length, 1)
  const perGroup = Math.max(1, ...groups.map((group) => group.parts.length))
  const slot = (width - PAD * 2) / count
  const gap = grouped ? Math.max(3, Math.min(6, slot * 0.05)) : 0
  const barWidth = grouped
    ? Math.max(8, Math.min(44, (slot * 0.62 - gap * (perGroup - 1)) / perGroup))
    : Math.max(8, Math.min(52, (slot * 0.7) / perGroup))
  const pairWidth = barWidth * perGroup + gap * (perGroup - 1)
  const max = Math.max(1, ...groups.flatMap((group) => group.parts.map((part) => part.value)))
  const unitHeight = (FLOOR - TOP) / max
  const step = gridStep(max)
  const levels = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step)
  // Подпись вуза не помещается в свою долю ширины (телефон, планшет, длинное
  // «БФУ им. И. Канта») — все подписи наклонены, чтобы не налезали друг на друга.
  // Ширина — по кеглю `--text-label-size` (12 px) с запасом на полужирную кириллицу.
  const longest = Math.max(0, ...groups.map((group) => group.label.length))
  const tilt = longest * 12 * 0.62 > slot - 8
  const height = HEIGHT + (tilt ? TILT_ROOM : 0)

  const layout = groups.map((group, index) => {
    const center = PAD + slot * index + slot / 2
    const left = center - pairWidth / 2
    const bars = group.parts.map((part, partIndex) => {
      const x = left + partIndex * (barWidth + gap)
      const top = FLOOR - part.value * unitHeight
      return { part, series: seriesOf(part), x, top }
    })
    return {
      group,
      center,
      left,
      top: Math.min(...bars.map((bar) => bar.top)),
      bars,
    }
  })

  // Рост — один раз: «ждём» до появления блока на экране, затем «растём».
  const grow = calm ? 'still' : inView ? 'run' : 'wait'

  // Подсказка — сбоку от пары на уровне её верха, внутри блока.
  const tipRef = useRef<HTMLDivElement>(null)
  const [tipAt, setTipAt] = useState<{ left: number; top: number } | null>(null)
  const spot = active !== null ? layout[active] : undefined
  useLayoutEffect(() => {
    const tip = tipRef.current
    if (!spot || !tip) {
      setTipAt(null)
      return
    }
    const room = 14
    let left = spot.left + pairWidth + room
    if (left + tip.offsetWidth > width) left = spot.left - room - tip.offsetWidth
    left = Math.max(0, Math.min(left, width - tip.offsetWidth))
    const top = Math.max(0, Math.min(spot.top - 6, FLOOR - tip.offsetHeight))
    setTipAt((current) => (current && current.left === left && current.top === top ? current : { left, top }))
    // `spot` — новый объект на каждый рендер; достаточно его координат.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot?.left, spot?.top, pairWidth, width, active])

  const fillOf = (series: Series) => (series === 'base' ? `url(#${id}-fade)` : `url(#${id}-hatch)`)

  return (
    <div ref={ref} className={styles.root} data-variant={variant} data-grow={grow} data-active={active !== null ? '' : undefined}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={styles.svg}
        role="group"
        aria-label={label}
        onPointerLeave={() => setActive(null)}
      >
        <defs>
          {/* Градиент первого столбика: светлый верх уходит в фон к полу. */}
          <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className={styles.fadeTop} />
            <stop offset="1" className={styles.fadeBottom} />
          </linearGradient>
          {/* Штриховка второго: косые линии 6 × 6, как у Bklit. */}
          <pattern id={`${id}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" className={styles.hatchGround} />
            <line x1="0" y1="0" x2="0" y2="6" className={styles.hatchLine} />
          </pattern>
        </defs>

        {/* Сетка — пунктир по «круглым» значениям; числа — над столбиками, оси не нужны. */}
        {levels.map((level) => (
          <line
            key={level}
            x1={PAD}
            x2={width - PAD}
            y1={FLOOR - level * unitHeight}
            y2={FLOOR - level * unitHeight}
            className={level === 0 ? styles.floor : styles.grid}
          />
        ))}

        {layout.map(({ group, center, left, bars }, index) => {
          const lit = index === active
          const body = (
            <g
              className={styles.group}
              data-lit={lit ? '' : undefined}
              onPointerEnter={(event) => {
                // Касание не «наводит»: после тапа пара не остаётся подсвеченной.
                if (event.pointerType !== 'touch') setActive(index)
              }}
              onPointerLeave={() => setActive((current) => (current === index ? null : current))}
            >
              {/* Полоса-мишень во всю высоту: навести можно и на низкий столбик; она же — рамка фокуса. */}
              <rect x={left - 10} y={TOP - 22} width={pairWidth + 20} height={FLOOR - TOP + 50} rx={10} className={styles.band} />
              <g className={styles.growth} style={{ '--bar-order': index } as CSSProperties}>
                {bars.map(({ part, series, x, top }) =>
                  part.value === 0 ? (
                    // Ноль — не пропуск: тонкая черта на полу, число над ней.
                    <rect
                      key={part.key}
                      x={x}
                      y={FLOOR - 2}
                      width={barWidth}
                      height={2}
                      className={styles.zero}
                      data-series={series}
                    />
                  ) : grouped ? (
                    <path
                      key={part.key}
                      d={roundedTop(x, top, barWidth, Math.min(7, barWidth / 3))}
                      className={styles.bar}
                      data-series={series}
                    />
                  ) : (
                    <rect
                      key={part.key}
                      x={x}
                      y={top}
                      width={barWidth}
                      height={FLOOR - top}
                      // Градиент и штриховка — ссылкой на <defs>; инлайн, чтобы правило заливки из CSS не перебило.
                      style={{ fill: fillOf(series) }}
                      className={styles.bar}
                      data-series={series}
                    />
                  ),
                )}
              </g>
              {/* Указатель Bklit: черта поднимается от пола к верху столбика. */}
              {!grouped &&
                lit &&
                bars.map(({ part, series, x, top }) => (
                  <motion.line
                    key={`indicator-${part.key}`}
                    x1={x}
                    x2={x + barWidth}
                    y1={0}
                    y2={0}
                    className={styles.indicator}
                    data-series={series}
                    initial={calm ? false : { y: FLOOR, opacity: 0 }}
                    animate={{
                      y: part.value === 0 ? FLOOR - 1 : top,
                      opacity: 1,
                    }}
                    transition={calm ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 30 }}
                  />
                ))}
              {bars.map(({ part, series, x, top }) => (
                <text
                  key={`value-${part.key}`}
                  x={x + barWidth / 2}
                  y={(part.value === 0 ? FLOOR - 2 : top) - 7}
                  textAnchor="middle"
                  className={styles.value}
                  data-series={series}
                  style={{ '--bar-order': index } as CSSProperties}
                >
                  {formatNumber(part.value)}
                </text>
              ))}
              <text
                x={center}
                y={FLOOR + 22}
                textAnchor={tilt ? 'end' : 'middle'}
                transform={tilt ? `rotate(-35 ${center} ${FLOOR + 22})` : undefined}
                className={styles.label}
              >
                {group.label}
              </text>
            </g>
          )
          return group.href ? (
            <Link
              key={group.key}
              href={group.href}
              aria-label={`${describe(group)}. Открыть страницу вуза`}
              className={styles.link}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
            >
              {body}
            </Link>
          ) : (
            <g
              key={group.key}
              tabIndex={0}
              role="img"
              aria-label={describe(group)}
              className={styles.link}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
            >
              {body}
            </g>
          )
        })}
      </svg>

      {/* Разбор пары — HTML над SVG, чтобы текст не масштабировался. Для чтения вслух хватает aria-label ссылки. */}
      {active !== null && groups[active] && (
        <div
          ref={tipRef}
          className={styles.tip}
          style={tipAt ? { left: tipAt.left, top: tipAt.top } : { visibility: 'hidden' }}
          aria-hidden
        >
          <strong className={styles.tipTitle}>{groups[active].title}</strong>
          {groups[active].parts.map((part) => (
            <span key={part.key} className={styles.tipRow}>
              <span className={styles.swatch} data-series={seriesOf(part)} aria-hidden />
              <span className={styles.tipLabel}>{part.label}</span>
              <span className={styles.tipValue}>{formatNumber(part.value)}</span>
            </span>
          ))}
        </div>
      )}

      <p className={styles.legend}>
        {groups[0]?.parts.map((part) => (
          <span key={part.key} className={styles.legendItem}>
            <span className={styles.swatch} data-series={seriesOf(part)} aria-hidden />
            {part.label}
          </span>
        ))}
      </p>
    </div>
  )
}
