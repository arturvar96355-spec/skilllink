'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'motion/react'
import { IconButton } from '../primitives/IconButton'
import { usePrefersReducedMotion } from '../hooks/dom'
import { expandInto } from '../lib/expand'
import styles from './TagCarousel.module.css'

/**
 * 3D-карусель бирок для реестров (решение 73, референс — New Zealanderlivery
 * Service: бирки веером, центральная — лицом к зрителю). Вид бирки задаёт
 * реестр (`renderTag`): у вузов — светлая багажная бирка, у программ — тёмный билет.
 *
 * Карточка в центре стоит прямо; соседние повёрнуты к центру и уходят в глубину,
 * дальние сложены плотнее. Листается перетаскиванием (мышь и палец), стрелками
 * на экране и клавиатуре, горизонтальной прокруткой тачпада. Щелчок по боковой
 * бирке выводит её в центр, по центральной — открывает страницу объекта: остальные
 * бирки быстро складываются в стопку за ней, от дальних к ближним, а сама бирка
 * перетекает в его страницу (lib/expand).
 *
 * Положение бирки — непрерывная функция смещения от центра: во время
 * перетаскивания смещение дробное, и веер плавно проворачивается за рукой,
 * а после отпускания пружиной встаёт на ближайшую бирку.
 */

/** Сколько бирок по каждую сторону видно; дальние скрыты. */
const VISIBLE_SIDE = 6
/** Пикселей перетаскивания на одну бирку. */
const DRAG_PER_CARD = 140
/** Складывание в стопку: одна бирка и шаг между соседними, с. */
const STACK_S = 0.26
const STACK_STEP_S = 0.025
/** Когда стопка собрана и пора открывать страницу, мс. */
const STACK_DONE_MS = (STACK_S + STACK_STEP_S * VISIBLE_SIDE) * 1000
const EASE_STACK = [0.65, 0, 0.35, 1] as const

type Pose = {
  x: number
  z: number
  rotateY: number
  scale: number
  opacity: number
}

/** Поза бирки по смещению от центра `d` (дробное во время перетаскивания). */
function poseAt(d: number, spread: number): Pose {
  const a = Math.abs(d)
  const sign = Math.sign(d)
  const near = Math.min(a, 1)
  const far = Math.max(a - 1, 0)
  return {
    x: sign * (near * 230 + far * 92) * spread,
    z: -(near * 140 + far * 70),
    rotateY: -sign * near * 52,
    scale: 1 - near * 0.1,
    opacity: a > VISIBLE_SIDE ? 0 : 1,
  }
}

/** Поза в стопке: бирки ровно друг за другом, чуть глубже и меньше. */
function stackedAt(d: number): Pose {
  const a = Math.abs(d)
  return { x: Math.sign(d) * a * 3, z: -a * 22, rotateY: 0, scale: 1 - a * 0.012, opacity: a > VISIBLE_SIDE ? 0 : 1 }
}

export interface TagCarouselProps<T> {
  items: T[]
  getKey: (item: T) => string
  getHref: (item: T) => string
  /** Название объекта — для подписи бирки у читалок экрана. */
  getLabel: (item: T) => string
  renderTag: (item: T) => ReactNode
  /** Подпись карусели: «Вузы», «Программы». */
  label: string
  /** Существительное для стрелок: «вуз» → «Предыдущий вуз». */
  noun: { previous: string; next: string }
  /** Оттенок листа, в который бирка перетекает в страницу. */
  tint?: string
}

export function TagCarousel<T>({
  items: rows,
  getKey,
  getHref,
  getLabel,
  renderTag,
  label,
  noun,
  tint,
}: TagCarouselProps<T>) {
  const router = useRouter()
  const reduced = usePrefersReducedMotion()
  /** Идёт уход на страницу объекта: `stack` — бирки складываются, `go` — бирка перетекает в страницу. */
  const [leaving, setLeaving] = useState<'stack' | 'go' | null>(null)
  const [index, setIndex] = useState(0)
  const [drag, setDrag] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [spread, setSpread] = useState(1)
  const stageRef = useRef<HTMLDivElement>(null)
  const pointer = useRef<{ id: number; x: number; moved: boolean } | null>(null)
  const wheelLock = useRef(0)
  /** Щелчок, которым закончилось перетаскивание, бирку не открывает. */
  const justDragged = useRef(false)

  const count = rows.length
  const last = Math.max(count - 1, 0)
  const current = Math.min(index, last)

  // Новая выборка (фильтр, страница) — снова с первой бирки.
  const firstId = rows[0] ? getKey(rows[0]) : undefined
  useEffect(() => setIndex(0), [firstId, count])

  // На узком экране веер сжимается, чтобы крайние бирки не уходили за край.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSpread(Math.max(0.45, Math.min(1, entry.contentRect.width / 1100)))
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  // Страница центрального объекта готовится заранее: к концу складывания она уже собрана.
  const currentItem = rows[current]
  const currentHref = currentItem ? getHref(currentItem) : null
  useEffect(() => {
    if (currentHref) router.prefetch(currentHref)
  }, [currentHref, router])

  function go(next: number) {
    if (leaving) return
    setIndex(Math.max(0, Math.min(last, next)))
  }

  // Горизонтальная прокрутка тачпада листает; вертикальная — прокручивает страницу, как обычно.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    function onWheel(event: WheelEvent) {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || Math.abs(event.deltaX) < 8) return
      event.preventDefault()
      const now = performance.now()
      if (now < wheelLock.current) return
      wheelLock.current = now + 180
      setIndex((value) => Math.max(0, Math.min(last, value + Math.sign(event.deltaX))))
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [last])

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || leaving) return
    pointer.current = { id: event.pointerId, x: event.clientX, moved: false }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = pointer.current
    if (!start || start.id !== event.pointerId) return
    const dx = event.clientX - start.x
    if (!start.moved && Math.abs(dx) < 6) return
    if (!start.moved) {
      start.moved = true
      setIsDragging(true)
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    // У краёв ленты — сопротивление, а не обрыв.
    const raw = -dx / DRAG_PER_CARD
    const target = current + raw
    const over = target < 0 ? target : target > last ? target - last : 0
    setDrag(raw - over * 0.7)
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = pointer.current
    pointer.current = null
    if (!start || start.id !== event.pointerId || !start.moved) return
    setIsDragging(false)
    justDragged.current = true
    window.setTimeout(() => (justDragged.current = false), 0)
    const velocityHint = Math.sign(drag) * 0.35
    go(Math.round(current + drag + velocityHint))
    setDrag(0)
  }

  function onCardClick(position: number, event: MouseEvent<HTMLButtonElement>) {
    if (justDragged.current) return
    const row = rows[position]
    if (!row) return
    if (position === current) open(row, event.currentTarget)
    else go(position)
  }

  function open(row: T, card: HTMLElement) {
    if (leaving) return
    const href = getHref(row)
    if (reduced) {
      router.push(href)
      return
    }
    setLeaving('stack')
    window.setTimeout(() => {
      setLeaving('go')
      expandInto(card, () => router.push(href), tint)
    }, STACK_DONE_MS)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowRight') go(current + 1)
    else if (event.key === 'ArrowLeft') go(current - 1)
    else if (event.key === 'Home') go(0)
    else if (event.key === 'End') go(last)
    else return
    event.preventDefault()
  }

  const focus = current + drag

  return (
    <div className={styles.root}>
      <div
        ref={stageRef}
        className={`${styles.stage} ${isDragging ? styles.dragging : ''}`}
        role="region"
        aria-roledescription="карусель"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {rows.map((row, position) => {
          const d = position - focus
          if (Math.abs(d) > VISIBLE_SIDE + 1) return null
          const isCurrent = position === current
          const a = Math.abs(d)
          const pose = leaving ? stackedAt(d) : poseAt(d, spread)
          return (
            <motion.button
              key={getKey(row)}
              type="button"
              className={`${styles.slot} ${isCurrent ? styles.current : ''}`}
              style={{ zIndex: 100 - Math.round(Math.abs(d) * 2) }}
              initial={false}
              animate={pose}
              transition={
                leaving === 'stack'
                  ? // От дальних к ближним: веер схлопывается к центру волной.
                    { duration: STACK_S, ease: EASE_STACK, delay: Math.max(0, VISIBLE_SIDE - a) * STACK_STEP_S }
                  : leaving === 'go'
                    ? { duration: 0 }
                    : isDragging || reduced
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 170, damping: 24, mass: 0.9 }
              }
              tabIndex={isCurrent ? 0 : -1}
              aria-label={isCurrent ? `${getLabel(row)} — открыть` : `${getLabel(row)} — показать`}
              aria-current={isCurrent || undefined}
              onClick={(event) => onCardClick(position, event)}
            >
              {renderTag(row)}
            </motion.button>
          )
        })}
      </div>

      <div className={styles.controls}>
        <IconButton icon="arrowLeft" label={noun.previous} onClick={() => go(current - 1)} disabled={current === 0} />
        <span className={styles.counter} aria-live="polite">
          {count === 0 ? 0 : current + 1} / {count}
        </span>
        <IconButton icon="arrowRight" label={noun.next} onClick={() => go(current + 1)} disabled={current >= last} />
      </div>
    </div>
  )
}
