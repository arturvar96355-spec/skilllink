'use client'

import { useEffect, useRef } from 'react'
import styles from './Shell.module.css'

/** Насколько быстро свечение догоняет курсор: ближнее — живее, дальнее — тянется следом. */
const FOLLOW_NEAR = 0.1
const FOLLOW_FAR = 0.035

/**
 * Живой фон: мягкое фиолетовое свечение плывёт за курсором, за ним с запаздыванием
 * тянется второе, глубже и шире, — фон переливается фиолетовым с чёрным. Под ними
 * очень медленно дышит дымка.
 *
 * Двигается только положение слоёв (transform) — видеокарта, без перерисовки.
 * Кадры считаются, только пока свечение догоняет курсор: неподвижный экран
 * ничего не стоит. При «уменьшить движение» и на сенсорных экранах свечение стоит
 * на месте — курсора там нет или движение просили убрать.
 */
export function LiveBackground() {
  const nearRef = useRef<HTMLDivElement | null>(null)
  const farRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const near = nearRef.current
    const far = farRef.current
    if (!near || !far) return

    const place = (element: HTMLElement, x: number, y: number) => {
      element.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
    }

    let targetX = window.innerWidth * 0.62
    let targetY = window.innerHeight * 0.28
    let nearX = targetX
    let nearY = targetY
    let farX = targetX
    let farY = targetY
    place(near, nearX, nearY)
    place(far, farX, farY)

    const still =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !window.matchMedia('(pointer: fine)').matches
    if (still) return

    let frame = 0
    const step = () => {
      nearX += (targetX - nearX) * FOLLOW_NEAR
      nearY += (targetY - nearY) * FOLLOW_NEAR
      farX += (targetX - farX) * FOLLOW_FAR
      farY += (targetY - farY) * FOLLOW_FAR
      place(near, nearX, nearY)
      place(far, farX, farY)
      const settled = Math.abs(targetX - farX) + Math.abs(targetY - farY) < 0.5
      frame = settled ? 0 : requestAnimationFrame(step)
    }

    const onMove = (event: PointerEvent) => {
      targetX = event.clientX
      targetY = event.clientY
      if (!frame) frame = requestAnimationFrame(step)
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div className={styles.liveBackground} aria-hidden="true">
      <div className={styles.haze} />
      {/* Сетка точек — как холст у Altitude и Melius (решение 79); у краёв гаснет. */}
      <div className={styles.dots} />
      <div ref={farRef} className={styles.glowFar} />
      <div ref={nearRef} className={styles.glowNear} />
    </div>
  )
}
