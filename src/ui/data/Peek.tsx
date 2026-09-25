'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
 * Всплывающая 3D-карточка при наведении (решение 88).
 *
 * Заменила приглушение строк: подсветка «чужое в тень» не объясняла, что
 * происходит. Теперь наведение на связку показывает её саму: маршрут
 * вуз → программа → продукт, ленту этапов на наклонной плоскости и что
 * случилось. Карточка плывёт за курсором на пружине и наклоняется по ходу
 * движения — как лист в воздухе. Только мышь или тачпад, в презентационном режиме.
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

const OFFSET = 18
const SPRING = { stiffness: 320, damping: 30, mass: 0.6 }

export function PeekProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [state, setState] = useState<PeekState | null>(null)
  const [fine, setFine] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const cardRef = useRef<HTMLDivElement>(null)

  const rawX = useMotionValue(0)
  const rawY = useMotionValue(0)
  const x = useSpring(rawX, SPRING)
  const y = useSpring(rawY, SPRING)
  // Наклон — от скорости: карточка отстаёт и кренится по ходу, потом выравнивается.
  const vx = useMotionValue(0)
  const vy = useMotionValue(0)
  const rotateY = useSpring(useTransform(vx, [-40, 40], [-14, 14], { clamp: true }), { stiffness: 180, damping: 18 })
  const rotateX = useSpring(useTransform(vy, [-40, 40], [12, -12], { clamp: true }), { stiffness: 180, damping: 18 })

  useEffect(() => {
    const query = window.matchMedia('(hover: hover) and (pointer: fine)')
    const sync = () => setFine(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  const place = useCallback(
    (clientX: number, clientY: number, jump: boolean) => {
      const card = cardRef.current?.getBoundingClientRect()
      const width = card?.width ?? 320
      const height = card?.height ?? 200
      // Справа снизу от курсора; у края окна — с другой стороны.
      const left = clientX + OFFSET + width > window.innerWidth - 8 ? clientX - OFFSET - width : clientX + OFFSET
      const top = clientY + OFFSET + height > window.innerHeight - 8 ? clientY - OFFSET - height : clientY + OFFSET
      vx.set(left - rawX.get())
      vy.set(top - rawY.get())
      rawX.set(left)
      rawY.set(top)
      if (jump) {
        x.jump(left)
        y.jump(top)
      }
    },
    [rawX, rawY, vx, vy, x, y],
  )

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
        const { clientX, clientY } = event
        // Короткая задержка: мимолётный проход курсором не мигает карточками.
        timer.current = window.setTimeout(() => {
          place(clientX, clientY, true)
          setState({ key, content })
        }, 90)
      },
      move: (event) => place(event.clientX, event.clientY, false),
      hide: (key) => {
        window.clearTimeout(timer.current)
        setState((current) => (current?.key === key ? null : current))
      },
    }),
    [active, place],
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
      <div className={styles.route}>
        <span className={styles.node}>{university}</span>
        <span className={styles.link} aria-hidden />
        <span className={styles.node}>{program}</span>
        <span className={styles.link} aria-hidden />
        <span className={[styles.node, product ? '' : styles.missing].filter(Boolean).join(' ')}>
          {product ?? 'продукт не выбран'}
        </span>
      </div>

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
