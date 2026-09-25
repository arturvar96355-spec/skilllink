'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useMotionTemplate, useMotionValue, useSpring, useTransform, type MotionValue } from 'motion/react'
import styles from './login.module.css'

/*
 * Объём экрана входа (решение 86): карточка наклоняется за курсором, по стеклу
 * скользит блик, левая колонка сдвигается слоями на разную глубину. Как у
 * стеклянных карточек AuthKit — но 3D-созвездие за экраном и переход на главную
 * не трогаются: движутся только колонки поверх него.
 *
 * Только для мыши и тачпада. На тач-экране (`hover: none`) и при «уменьшить
 * движение» всё стоит — правило для мобилки (PR #73): эффекты за курсором
 * на телефоне неподвижны.
 */

/** Пружина: догоняет курсор мягко, без дрожи и без «резинки». */
const SPRING = { stiffness: 140, damping: 20, mass: 0.6 }

interface Scene {
  /** Курсор по окну: −1 у левого/верхнего края, 1 у правого/нижнего. */
  x: MotionValue<number>
  y: MotionValue<number>
  enabled: boolean
}

const SceneContext = createContext<Scene | null>(null)

function useDepthEnabled(): boolean {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)')
    const sync = () => setEnabled(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])
  return enabled
}

/** Общий курсор сцены: один обработчик на окно, пружины на всех слоях. */
export function DepthScene({ children }: { children: ReactNode }) {
  const enabled = useDepthEnabled()
  const rawX = useMotionValue(0)
  const rawY = useMotionValue(0)
  const x = useSpring(rawX, SPRING)
  const y = useSpring(rawY, SPRING)

  useEffect(() => {
    if (!enabled) {
      rawX.set(0)
      rawY.set(0)
      return
    }
    const onMove = (event: PointerEvent) => {
      rawX.set((event.clientX / window.innerWidth) * 2 - 1)
      rawY.set((event.clientY / window.innerHeight) * 2 - 1)
    }
    // Курсор ушёл из окна — сцена спокойно возвращается в покой.
    const onLeave = () => {
      rawX.set(0)
      rawY.set(0)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
    }
  }, [enabled, rawX, rawY])

  return <SceneContext.Provider value={{ x, y, enabled }}>{children}</SceneContext.Provider>
}

/**
 * Слой левой колонки: сдвигается против курсора на `depth` пикселей — ближние
 * слои дальше, дальние меньше, отсюда и объём. Обёртка, а не сам элемент:
 * у элементов свои анимации появления и ухода по transform.
 */
export function DepthLayer({ depth, children }: { depth: number; children: ReactNode }) {
  const scene = useContext(SceneContext)
  const zero = useMotionValue(0)
  const x = useTransform(scene?.x ?? zero, (value) => value * -depth)
  const y = useTransform(scene?.y ?? zero, (value) => value * -depth * 0.6)
  return (
    <motion.div className={styles.layer} style={scene?.enabled ? { x, y } : undefined}>
      {children}
    </motion.div>
  )
}

/** Наибольший наклон, градусы: курсор над карточкой и где-то в стороне. */
const TILT_NEAR = 9
const TILT_FAR = 3

/**
 * Карточка в 3D: наклоняется к курсору, над ней — сильнее и чуть приподнимается,
 * по стеклу скользит блик из точки под курсором. После входа (`resting`)
 * выравнивается, чтобы уход панели шёл как раньше.
 */
export function TiltCard({ resting, children }: { resting: boolean; children: ReactNode }) {
  const scene = useContext(SceneContext)
  const enabled = Boolean(scene?.enabled) && !resting
  const ref = useRef<HTMLDivElement>(null)

  const rotateX = useSpring(0, SPRING)
  const rotateY = useSpring(0, SPRING)
  const lift = useSpring(1, SPRING)
  const glareX = useMotionValue(50)
  const glareY = useMotionValue(0)
  const glareOpacity = useSpring(0, SPRING)
  const glare = useMotionTemplate`radial-gradient(420px circle at ${glareX}% ${glareY}%, var(--glass-glare), transparent 60%)`

  useEffect(() => {
    if (!enabled) {
      rotateX.set(0)
      rotateY.set(0)
      lift.set(1)
      glareOpacity.set(0)
      return
    }
    const onMove = (event: PointerEvent) => {
      const card = ref.current?.getBoundingClientRect()
      if (!card) return
      // Положение курсора относительно центра карточки: ±1 — её края.
      const dx = (event.clientX - (card.left + card.width / 2)) / (card.width / 2)
      const dy = (event.clientY - (card.top + card.height / 2)) / (card.height / 2)
      const inside = Math.abs(dx) <= 1 && Math.abs(dy) <= 1
      const limit = inside ? TILT_NEAR : TILT_FAR
      const clamp = (value: number) => Math.max(-1, Math.min(1, value))
      rotateY.set(clamp(dx) * limit)
      rotateX.set(-clamp(dy) * limit)
      lift.set(inside ? 1.02 : 1)
      glareX.set(((clamp(dx) + 1) / 2) * 100)
      glareY.set(((clamp(dy) + 1) / 2) * 100)
      glareOpacity.set(inside ? 1 : 0)
    }
    const onLeave = () => {
      rotateX.set(0)
      rotateY.set(0)
      lift.set(1)
      glareOpacity.set(0)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
    }
  }, [enabled, rotateX, rotateY, lift, glareX, glareY, glareOpacity])

  return (
    <motion.div
      ref={ref}
      className={styles.tilt}
      style={{ rotateX, rotateY, scale: lift, transformPerspective: 1000 }}
    >
      {children}
      <motion.span
        className={styles.glare}
        style={{ backgroundImage: glare, opacity: glareOpacity }}
        aria-hidden="true"
      />
    </motion.div>
  )
}
