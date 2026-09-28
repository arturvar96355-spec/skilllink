'use client'

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import Link from 'next/link'
import { motion, type Transition } from 'motion/react'
import { useCalmMotion } from '../hooks/ui-mode'
import { useReveal } from '../hooks/reveal'
import { formatNumber } from '../lib/format'
import type { Bars3DGroup, Bars3DPart } from './Bars3D'
import { placeBarTip, stepIndex, type TipSide } from './bars-flat'
import styles from './BarsFlat.module.css'

/**
 * Плоские столбики в духе Bklit (решения 198, 201) — замена объёмных Bars3D на главной.
 * У каждой группы (вуза) — пара столбиков рядом, а не колонка из частей:
 * так видно и сколько связок идёт спокойно, и сколько требует внимания, без
 * вычитания в уме.
 *
 * Два вида на выбор владельца (`variant`):
 * - `grouped` (выбран владельцем) — пара со скруглённым верхом и зазором. В покое
 *   столбики приглушены, числа над ними — мелко и вторичным цветом. Наведение,
 *   фокус или касание выбирают вуз, как у Bklit bar chart: его пара светлеет
 *   (основной столбик — сильнее), остальные гаснут; через пару проходит тонкая
 *   линия-указатель, на верхушках — кружки-маркеры, подпись на оси становится
 *   «таблеткой», рядом — подсказка с полным названием и разбором;
 * - `indicator` — пара вплотную: первый столбик — градиент, уходящий в фон,
 *   второй — штриховка по диагонали; при наведении по столбикам поднимается
 *   черта-указатель до их верха.
 *
 * Клавиатура: в блок ведёт одна остановка Tab, стрелки и Home/End выбирают вуз,
 * Enter открывает его страницу, Esc прячет подсказку. На телефоне первое касание
 * показывает подсказку, второе по тому же вузу — открывает страницу.
 *
 * Столбики вырастают один раз, когда блок дошёл до экрана; при «уменьшить
 * движение» и в рабочем режиме — сразу в конечном виде, указатель и подсказка
 * переставляются без скольжения.
 */
export type BarsFlatVariant = 'grouped' | 'indicator'

type Series = 'base' | 'signal'

/** Сигнальные части (требуют внимания) — тёплым тоном, остальные — нейтральным. */
const seriesOf = (part: Bars3DPart): Series => (part.tone === 'danger' || part.tone === 'warning' ? 'signal' : 'base')

/** «Идут по плану» → «идут по плану»: в строке подсказки подпись идёт после точки серии. */
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

const DEFAULT_WIDTH = 960
const HEIGHT = 262
/** Линия пола и место сверху под числа над столбиками. */
const FLOOR = 218
const TOP = 34
/** Верх линии-указателя: над числами самого высокого столбика. */
const CROSS_TOP = TOP - 22
/** Зазор между концом указателя и верхушкой пары. */
const CROSS_GAP = 8
/** Запас снизу под наклонённые подписи на узком экране. */
const TILT_ROOM = 44
const PAD = 8
/** Подпись вуза под полом (базовая линия текста). */
const LABEL_Y = FLOOR + 22

/** Переезд указателя, маркеров и подсказки к соседнему вузу — короткая пружина без отскока. */
const GLIDE: Transition = { type: 'spring', stiffness: 520, damping: 42, mass: 0.7 }
const JUMP: Transition = { duration: 0 }

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

/** Строка для чтения вслух: «МТУСИ: идут по плану — 3, требуют внимания — 2». */
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
  // Одна остановка Tab на весь график: в фокус попадает последний выбранный вуз.
  const [rover, setRover] = useState(0)
  const itemRefs = useRef<(HTMLElement | SVGElement | null)[]>([])
  const labelRefs = useRef<(SVGTextElement | null)[]>([])
  // Касание: было ли у вуза уже показано «первое касание» к моменту нажатия.
  const press = useRef<{ type: string; wasActive: boolean }>({ type: 'mouse', wasActive: false })

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

  // Подсказку, открытую касанием, закрывает касание мимо графика.
  useEffect(() => {
    if (active === null) return
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setActive(null)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [active])

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
      const top = part.value === 0 ? FLOOR - 2 : FLOOR - part.value * unitHeight
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
  const spot = active !== null ? layout[active] : undefined

  // Подсказка — сбоку от пары (у правого края — слева), внутри блока, не на столбиках.
  // Первое появление — сразу на месте; переход к соседнему вузу — скольжением.
  const tipRef = useRef<HTMLDivElement>(null)
  const tipShown = useRef(false)
  const [tipAt, setTipAt] = useState<{ left: number; top: number; side: TipSide; jump: boolean } | null>(null)
  useLayoutEffect(() => {
    const tip = tipRef.current
    if (!spot || !tip) {
      tipShown.current = false
      setTipAt(null)
      return
    }
    const at = placeBarTip(
      { left: spot.left, right: spot.left + pairWidth, top: spot.top },
      { width: tip.offsetWidth, height: tip.offsetHeight },
      { width, floor: FLOOR, bottom: ref.current?.offsetHeight },
    )
    const jump = !tipShown.current
    tipShown.current = true
    setTipAt((current) =>
      current && current.left === at.left && current.top === at.top ? current : { ...at, jump },
    )
    // `spot` — новый объект на каждый рендер; достаточно его координат.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot?.left, spot?.top, pairWidth, width, active])

  // «Таблетка» под подписью выбранного вуза — по размеру самого текста.
  const [pill, setPill] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const text = active !== null ? labelRefs.current[active] : null
    if (!text) {
      setPill(null)
      return
    }
    const box = text.getBBox()
    setPill({ x: box.x - 10, y: box.y - 4, width: box.width + 20, height: box.height + 8 })
  }, [active, width, tilt])

  const glide = calm ? JUMP : GLIDE

  const choose = (index: number) => {
    setActive(index)
    setRover(index)
  }

  const onKeyDown = (event: ReactKeyboardEvent, index: number) => {
    if (event.key === 'Escape') {
      setActive(null)
      return
    }
    const next = stepIndex(event.key, index, groups.length)
    if (next === null) return
    event.preventDefault()
    itemRefs.current[next]?.focus()
  }

  const onPointerDown = (event: ReactPointerEvent, index: number) => {
    press.current = { type: event.pointerType, wasActive: active === index }
  }

  // Первое касание вуза — подсказка, второе — страница. Мышь и клавиатура — сразу страница.
  const onClick = (event: ReactMouseEvent, index: number) => {
    if (press.current.type === 'touch' && !press.current.wasActive) {
      event.preventDefault()
      choose(index)
    }
  }

  const fillOf = (series: Series) => (series === 'base' ? `url(#${id}-fade)` : `url(#${id}-hatch)`)
  const activeGroup = active !== null ? groups[active] : undefined

  return (
    <div
      ref={ref}
      className={styles.root}
      data-variant={variant}
      data-grow={grow}
      data-active={active !== null ? '' : undefined}
      data-tip={tipAt?.side}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={styles.svg}
        role="group"
        aria-label={label}
        aria-describedby={`${id}-keys`}
        onPointerLeave={(event) => {
          // Касание «уходит» сразу после отпускания пальца — подсказка остаётся до касания мимо.
          if (event.pointerType !== 'touch') setActive(null)
        }}
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
                // Касание не «наводит»: его обрабатывает щелчок (первое касание — подсказка).
                if (event.pointerType !== 'touch') setActive(index)
              }}
            >
              {/* Мишень — вся доля вуза во всю высоту: между парами нет «дыр», указатель не мигает. */}
              <rect x={center - slot / 2} y={0} width={slot} height={height} className={styles.hit} />
              {/* Рамка фокуса с клавиатуры. */}
              <rect x={left - 10} y={TOP - 22} width={pairWidth + 20} height={FLOOR - TOP + 26} rx={10} className={styles.ring} />
              <g className={styles.growth} style={{ '--bar-order': index } as CSSProperties}>
                {bars.map(({ part, series, x, top }) =>
                  part.value === 0 ? (
                    // Ноль — не пропуск: тонкая черта на полу, число над ней.
                    <rect key={part.key} x={x} y={FLOOR - 2} width={barWidth} height={2} className={styles.zero} data-series={series} />
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
              {/* Указатель вида «indicator»: черта поднимается от пола к верху столбика. */}
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
                    animate={{ y: part.value === 0 ? FLOOR - 1 : top, opacity: 1 }}
                    transition={calm ? JUMP : { type: 'spring', stiffness: 320, damping: 30 }}
                  />
                ))}
              {bars.map(({ part, series, x, top }) => (
                <text
                  key={`value-${part.key}`}
                  x={x + barWidth / 2}
                  y={top - 7}
                  textAnchor="middle"
                  className={styles.value}
                  data-series={series}
                  style={{ '--bar-order': index } as CSSProperties}
                >
                  {formatNumber(part.value)}
                </text>
              ))}
              <g transform={tilt ? `rotate(-35 ${center} ${LABEL_Y})` : undefined}>
                {lit && pill && (
                  <rect
                    x={pill.x}
                    y={pill.y}
                    width={pill.width}
                    height={pill.height}
                    rx={pill.height / 2}
                    className={styles.pill}
                  />
                )}
                <text
                  ref={(node) => {
                    labelRefs.current[index] = node
                  }}
                  x={center}
                  y={LABEL_Y}
                  textAnchor={tilt ? 'end' : 'middle'}
                  className={styles.label}
                >
                  {group.label}
                </text>
              </g>
            </g>
          )
          const shared = {
            tabIndex: index === Math.min(rover, groups.length - 1) ? 0 : -1,
            className: styles.link,
            onFocus: () => choose(index),
            onBlur: () => setActive(null),
            onKeyDown: (event: ReactKeyboardEvent) => onKeyDown(event, index),
          }
          return group.href ? (
            <Link
              key={group.key}
              ref={(node: HTMLAnchorElement | null) => {
                itemRefs.current[index] = node
              }}
              href={group.href}
              aria-label={`${describe(group)}. Открыть страницу вуза`}
              onPointerDown={(event) => onPointerDown(event, index)}
              onClick={(event) => onClick(event, index)}
              {...shared}
            >
              {body}
            </Link>
          ) : (
            <g
              key={group.key}
              ref={(node) => {
                itemRefs.current[index] = node
              }}
              role="img"
              aria-label={describe(group)}
              {...shared}
            >
              {body}
            </g>
          )
        })}

        {/*
          Указатель — тонкий пунктир над парой, до её верхушки, а не сплошная тёмная
          линия сквозь столбики; кружков на верхушках нет: они садились на скругление
          и читались «булавками» с выемкой. Пара и так выделена подсветкой и подсказкой.
          Переезжает к соседнему вузу, а не мигает.
        */}
        {grouped && spot && (
          <motion.g
            className={styles.cross}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: calm ? 0 : 0.14 }}
            aria-hidden
          >
            <motion.line
              y1={CROSS_TOP}
              className={styles.crossLine}
              initial={false}
              animate={{
                x1: spot.center,
                x2: spot.center,
                y2: Math.max(CROSS_TOP, Math.min(...spot.bars.map(({ top }) => top)) - CROSS_GAP),
              }}
              transition={glide}
            />
          </motion.g>
        )}
      </svg>

      <p id={`${id}-keys`} className="visually-hidden">
        Стрелки влево и вправо — соседний вуз, Enter — страница вуза.
      </p>

      {/* Разбор пары — HTML над SVG, чтобы текст не масштабировался. Для чтения вслух хватает aria-label ссылки. */}
      {activeGroup && (
        <motion.div
          ref={tipRef}
          className={styles.tip}
          style={{ left: 0, top: 0, visibility: tipAt ? undefined : 'hidden' }}
          initial={{ opacity: 0 }}
          animate={tipAt ? { x: tipAt.left, y: tipAt.top, opacity: 1 } : { opacity: 0 }}
          transition={{
            x: tipAt?.jump ? JUMP : glide,
            y: tipAt?.jump ? JUMP : glide,
            opacity: calm ? JUMP : { duration: 0.14 },
          }}
          aria-hidden
        >
          <strong className={styles.tipTitle}>{activeGroup.title}</strong>
          {activeGroup.parts.map((part) => (
            <span key={part.key} className={styles.tipRow}>
              <span className={styles.swatch} data-series={seriesOf(part)} aria-hidden />
              <span className={styles.tipLabel}>{lowerFirst(part.label)}</span>
              <span className={styles.tipValue}>{formatNumber(part.value)}</span>
            </span>
          ))}
        </motion.div>
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
