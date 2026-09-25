'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'motion/react'
import { IconButton } from '../primitives/IconButton'
import { Icon } from '../primitives/Icon'
import { useCalmMotion } from '../hooks/ui-mode'
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
  /** Факты центральной бирки слева от карусели, как у A24 (решение 79). */
  renderFacts?: (item: T) => ReactNode
  /** Строка в списке «Index»: название и пояснение справа. */
  getIndexMeta?: (item: T) => string
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
  renderFacts,
  getIndexMeta,
}: TagCarouselProps<T>) {
  const router = useRouter()
  const reduced = useCalmMotion()
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
  const [indexOpen, setIndexOpen] = useState(false)
  const indexRef = useRef<HTMLDivElement>(null)
  /** Подпись у курсора над сценой (как у Altitude): «листать» или «открыть». */
  const [cursor, setCursor] = useState<{ x: number; y: number; label: string } | null>(null)
  const hoverCapable = useRef(false)
  useEffect(() => {
    hoverCapable.current = window.matchMedia('(hover: hover) and (pointer: fine)').matches
  }, [])

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

  /**
   * Колесо над сценой листает (как у A24): и горизонтальная прокрутка тачпада,
   * и обычное колесо. На первой и последней бирке прокрутка в сторону края
   * отдаётся странице — сцена не запирает человека.
   */
  const currentRef = useRef(current)
  currentRef.current = current
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    function onWheel(event: WheelEvent) {
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      const delta = horizontal ? event.deltaX : event.deltaY
      if (Math.abs(delta) < 4) return
      const step = Math.sign(delta)
      const at = currentRef.current
      if (!horizontal && ((step < 0 && at === 0) || (step > 0 && at === last))) return
      event.preventDefault()
      const now = performance.now()
      if (now < wheelLock.current) return
      wheelLock.current = now + 220
      setIndex((value) => Math.max(0, Math.min(last, value + step)))
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [last])

  // Список «Index» закрывается щелчком мимо и клавишей Escape.
  useEffect(() => {
    if (!indexOpen) return
    const onDown = (event: globalThis.PointerEvent) => {
      if (!indexRef.current?.contains(event.target as Node)) setIndexOpen(false)
    }
    const onKey = (event: globalThis.KeyboardEvent) => event.key === 'Escape' && setIndexOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [indexOpen])

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || leaving) return
    pointer.current = { id: event.pointerId, x: event.clientX, moved: false }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (hoverCapable.current && event.pointerType === 'mouse') {
      const box = event.currentTarget.getBoundingClientRect()
      const onCurrent = (event.target as Element).closest('[aria-current]') !== null
      setCursor({
        x: event.clientX - box.left,
        y: event.clientY - box.top,
        label: isDragging ? 'листаю' : onCurrent ? 'открыть' : 'листать',
      })
    }
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

  /**
   * Какая бирка видна в этой точке экрана (решение 127). Бирки лежат веером:
   * у боковой видна только полоска края, а браузер отдаёт щелчок той, что лежит
   * сверху по глубине, — «соседняя перехватывает щелчок». Поэтому решаем сами,
   * по прямоугольникам на экране: в пределах передней — передняя; правее или
   * левее — та боковая, чья видимая полоска накрывает точку.
   */
  function positionAt(x: number): number | null {
    const stage = stageRef.current
    if (!stage) return null
    const slots = Array.from(stage.querySelectorAll<HTMLElement>('[data-position]')).map((element) => ({
      position: Number(element.dataset.position),
      rect: element.getBoundingClientRect(),
    }))
    const front = slots.find((slot) => slot.position === current)
    if (!front) return null
    if (x >= front.rect.left && x <= front.rect.right) return current
    if (x > front.rect.right) {
      const right = slots.filter((slot) => slot.position > current).sort((a, b) => a.position - b.position)
      for (const slot of right) if (x <= slot.rect.right) return slot.position
      return right.at(-1)?.position ?? null
    }
    const left = slots.filter((slot) => slot.position < current).sort((a, b) => b.position - a.position)
    for (const slot of left) if (x >= slot.rect.left) return slot.position
    return left.at(-1)?.position ?? null
  }

  function onCardClick(_position: number, event: MouseEvent<HTMLElement>) {
    if (justDragged.current) return
    // Клавиатура (Enter/пробел) даёт щелчок без координат — тогда бирка та, на которой фокус.
    const position = event.detail === 0 ? _position : (positionAt(event.clientX) ?? _position)
    const row = rows[position]
    if (!row) return
    if (position === current) {
      const card = stageRef.current?.querySelector<HTMLElement>(`[data-position="${position}"]`) ?? (event.currentTarget as HTMLElement)
      open(row, card)
    } else go(position)
  }

  // Стрелки ← → листают на всей странице, а не только с фокусом на карусели —
  // если фокус не в поле ввода, не открыто окно и карусель на экране.
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]')) return
      if (stageRef.current?.contains(target)) return // свой обработчик у сцены
      const rect = stageRef.current?.getBoundingClientRect()
      if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) return
      if (event.key === 'ArrowRight') go(current + 1)
      else if (event.key === 'ArrowLeft') go(current - 1)
      else if (event.key === 'Home') go(0)
      else go(last)
      event.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

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
    <div className={`${styles.root} ${renderFacts ? styles.withFacts : ''}`}>
      {renderFacts && currentItem && (
        // Факты центральной бирки — сменяются вместе с ней (A24).
        <aside className={styles.facts} aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={getKey(currentItem)}
              initial={reduced ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              {renderFacts(currentItem)}
            </motion.div>
          </AnimatePresence>
        </aside>
      )}
      <div className={styles.main}>
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
          onPointerLeave={() => setCursor(null)}
          // Щелчок мимо бирок — у края дальней бирки: тоже по координате.
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('[data-position]')) return
            onCardClick(current, event)
          }}
        >
          {cursor && (
            <span
              className={styles.cursorLabel}
              style={{ transform: `translate(${cursor.x + 16}px, ${cursor.y + 16}px)` }}
              aria-hidden
            >
              {cursor.label}
            </span>
          )}
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
                data-position={position}
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
          {/* «Index» — весь список сразу, как у A24: к любой бирке за один щелчок. */}
          <div ref={indexRef} className={styles.index}>
            <button
              type="button"
              className={styles.indexButton}
              aria-expanded={indexOpen}
              aria-haspopup="listbox"
              onClick={() => setIndexOpen((open) => !open)}
            >
              Весь список
              <Icon name="chevronDown" size={16} />
            </button>
            <AnimatePresence>
              {indexOpen && (
                <motion.ul
                  className={styles.indexList}
                  role="listbox"
                  aria-label={label}
                  initial={reduced ? false : { opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduced ? undefined : { opacity: 0, y: 8, scale: 0.98 }}
                  transition={{ duration: 0.18 }}
                >
                  {rows.map((row, position) => (
                    <li key={getKey(row)}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={position === current}
                        className={`${styles.indexItem} ${position === current ? styles.indexItemCurrent : ''}`}
                        onClick={() => {
                          go(position)
                          setIndexOpen(false)
                        }}
                      >
                        <span className={styles.indexNumber}>{String(position + 1).padStart(2, '0')}</span>
                        <span className={styles.indexTitle}>{getLabel(row)}</span>
                        {getIndexMeta && <span className={styles.indexMeta}>{getIndexMeta(row)}</span>}
                      </button>
                    </li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
}
