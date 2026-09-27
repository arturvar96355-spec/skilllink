'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from 'motion/react'
import styles from './Peek.module.css'

/**
 * Всплывающая 3D-карточка при наведении (решение 95).
 *
 * Заменила приглушение строк: подсветка «чужое в тень» не объясняла, что
 * происходит. Теперь наведение на связку показывает её саму: маршрут
 * вуз → программа → продукт, ленту этапов на наклонной плоскости и что
 * случилось. Карточка встаёт рядом со строкой — справа или слева, строка
 * остаётся видна (решение 211) — и чуть кренится, когда курсор движется над
 * строкой. Только мышь или тачпад, в презентационном режиме.
 *
 * Где карточка работает, у строки не должно быть своего `title`: браузер
 * показывал бы вторую, мелкую подсказку поверх карточки. Страница спрашивает
 * это у `usePeekEnabled()`.
 */

interface PeekState {
  content: ReactNode
  key: string
}

interface PeekApi {
  enabled: boolean
  show: (key: string, content: ReactNode, event: ReactPointerEvent) => void
  move: (event: ReactPointerEvent) => void
  hide: (key: string) => void
}

const PeekContext = createContext<PeekApi | null>(null)

/** Зазор между строкой и карточкой и отступ карточки от края окна, px. */
const GAP = 14
const EDGE = 8
/** Ширина карточки до первого замера — как в Peek.module.css. */
const DEFAULT_WIDTH = 380
const DEFAULT_HEIGHT = 240
const SPRING = { stiffness: 320, damping: 30, mass: 0.6 }

/**
 * Место карточки рядом со строкой, а не на ней (решение 211, п. 3): справа от
 * строки, нет места — слева, нет и там — под строкой. По высоте — вровень
 * с верхом строки, в пределах окна. Раньше карточка шла за курсором справа
 * снизу и закрывала саму строку, на которую навели, и соседние.
 */
export function peekPlacement(
  row: { left: number; right: number; top: number; bottom: number },
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  pointerX: number,
): { left: number; top: number } {
  const clampTop = (value: number) => Math.max(EDGE, Math.min(value, viewport.height - card.height - EDGE))
  if (row.right + GAP + card.width <= viewport.width - EDGE) return { left: row.right + GAP, top: clampTop(row.top) }
  if (row.left - GAP - card.width >= EDGE) return { left: row.left - GAP - card.width, top: clampTop(row.top) }
  const left = Math.max(EDGE, Math.min(pointerX - card.width / 2, viewport.width - card.width - EDGE))
  const below = row.bottom + GAP
  const top = below + card.height <= viewport.height - EDGE ? below : row.top - GAP - card.height
  return { left, top: Math.max(EDGE, top) }
}

export function PeekProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [state, setState] = useState<PeekState | null>(null)
  const [fine, setFine] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const cardRef = useRef<HTMLDivElement>(null)
  /** Строка, над которой карточка, и где был курсор, — чтобы поставить её заново после замера. */
  const anchor = useRef<{ row: DOMRect; pointerX: number } | null>(null)

  const rawX = useMotionValue(0)
  const rawY = useMotionValue(0)
  const x = useSpring(rawX, SPRING)
  const y = useSpring(rawY, SPRING)
  // Наклон — от движения курсора над строкой: карточка чуть кренится по ходу и выравнивается.
  const vx = useMotionValue(0)
  const vy = useMotionValue(0)
  const rotateY = useSpring(useTransform(vx, [-40, 40], [-8, 8], { clamp: true }), { stiffness: 180, damping: 18 })
  const rotateX = useSpring(useTransform(vy, [-40, 40], [6, -6], { clamp: true }), { stiffness: 180, damping: 18 })

  useEffect(() => {
    const query = window.matchMedia('(hover: hover) and (pointer: fine)')
    const sync = () => setFine(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  const place = useCallback(
    (jump: boolean) => {
      const current = anchor.current
      if (!current) return
      const card = cardRef.current?.getBoundingClientRect()
      const { left, top } = peekPlacement(
        current.row,
        { width: card?.width || DEFAULT_WIDTH, height: card?.height || DEFAULT_HEIGHT },
        { width: window.innerWidth, height: window.innerHeight },
        current.pointerX,
      )
      rawX.set(left)
      rawY.set(top)
      if (jump) {
        x.jump(left)
        y.jump(top)
      }
    },
    [rawX, rawY, x, y],
  )

  // Карточка отрисована — её настоящая высота известна: ставим заново, без пружины.
  useLayoutEffect(() => {
    if (state) place(true)
  }, [state, place])

  // Скорость гаснет сама: без движения карточка выпрямляется.
  useEffect(() => {
    if (!state) return
    const id = window.setInterval(() => {
      vx.set(vx.get() * 0.6)
      vy.set(vy.get() * 0.6)
    }, 60)
    return () => window.clearInterval(id)
  }, [state, vx, vy])

  const active = enabled && fine
  const api = useMemo<PeekApi>(
    () => ({
      enabled: active,
      show: (key, content, event) => {
        window.clearTimeout(timer.current)
        const row = event.currentTarget.getBoundingClientRect()
        const pointerX = event.clientX
        // Короткая задержка: мимолётный проход курсором не мигает карточками.
        timer.current = window.setTimeout(() => {
          anchor.current = { row, pointerX }
          place(true)
          setState({ key, content })
        }, 90)
      },
      move: (event) => {
        vx.set(event.movementX * 4)
        vy.set(event.movementY * 4)
      },
      hide: (key) => {
        window.clearTimeout(timer.current)
        setState((current) => (current?.key === key ? null : current))
      },
    }),
    [active, place, vx, vy],
  )

  // Прокрутка уводит строку из-под курсора — карточку не держим в воздухе.
  useEffect(() => {
    if (!state) return
    const close = () => setState(null)
    window.addEventListener('scroll', close, { passive: true, capture: true })
    return () => window.removeEventListener('scroll', close, { capture: true })
  }, [state])

  return (
    <PeekContext.Provider value={api}>
      {children}
      {active &&
        typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {state && (
              <motion.div
                ref={cardRef}
                key={state.key}
                className={styles.card}
                style={{ x, y, rotateX, rotateY, transformPerspective: 900 }}
                initial={{ opacity: 0, scale: 0.9, filter: 'blur(6px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, scale: 0.94, filter: 'blur(4px)', transition: { duration: 0.12 } }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                role="tooltip"
              >
                {state.content}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </PeekContext.Provider>
  )
}

/** Карточка при наведении сейчас работает (презентационный режим, мышь или тачпад). */
export function usePeekEnabled(): boolean {
  return useContext(PeekContext)?.enabled ?? false
}

/** Обработчики для элемента, над которым должна всплывать карточка. */
export function usePeek() {
  const api = useContext(PeekContext)
  return useCallback(
    (key: string, content: () => ReactNode) => {
      if (!api?.enabled) return {}
      return {
        onPointerEnter: (event: ReactPointerEvent) => api.show(key, content(), event),
        onPointerMove: (event: ReactPointerEvent) => api.move(event),
        onPointerLeave: () => api.hide(key),
      }
    },
    [api],
  )
}

/**
 * Содержимое карточки связки: маршрут, лента этапов в перспективе с «колонной»
 * текущего этапа и строка состояния.
 */
export function CooperationPeek({
  university,
  program,
  product,
  stage,
  stageTitle,
  done,
  total,
  state,
  status,
}: {
  university: string
  program: string
  product: string | null
  stage: number | null
  stageTitle: string | null
  done: number | null
  total: number
  state: 'ok' | 'overdue' | 'blocked'
  /** Строка состояния: «Просрочен на 57 дней», «Заблокирован», «Идёт по плану». */
  status: string
}) {
  return (
    <div className={styles.body}>
      {/* Маршрут связки — столбиком и полностью, без многоточий (решение 211):
          в одну строку вуз, программа и продукт обрезались до десятка букв. */}
      <ol className={styles.route}>
        <li className={styles.node}>{university}</li>
        <li className={styles.node}>{program}</li>
        <li className={[styles.node, product ? '' : styles.missing].filter(Boolean).join(' ')}>
          {product ?? 'продукт не выбран'}
        </li>
      </ol>

      {/* Лента этапов лежит на наклонной плоскости; текущий этап — поднятая колонна. */}
      <div className={styles.floor} aria-hidden>
        <div className={styles.plane}>
          {Array.from({ length: total }, (_, index) => {
            const number = index + 1
            const kind =
              number === stage ? styles[state] : done !== null && index < done ? styles.done : ''
            return (
              <span
                key={index}
                className={[styles.cell, kind, number === stage ? styles.pillar : ''].filter(Boolean).join(' ')}
                style={{ '--c': index } as CSSProperties}
              />
            )
          })}
        </div>
      </div>

      <div className={styles.stageLine}>
        <span className={styles.notation}>
          {/* В ленте — этапы, которые ведут люди; 14-й «Контроль» закрывает система. */}
          {stage === null ? 'все этапы' : `${String(stage).padStart(2, '0')} / ${total + 1}`}
        </span>
        {stageTitle && <span className={styles.stageTitle}>{stageTitle}</span>}
      </div>
      <span className={[styles.status, styles[`${state}Text`]].filter(Boolean).join(' ')}>{status}</span>
    </div>
  )
}
