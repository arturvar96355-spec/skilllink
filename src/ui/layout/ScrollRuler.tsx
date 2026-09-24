'use client'

import { useEffect, useRef } from 'react'
import styles from './ScrollRuler.module.css'

/**
 * Линейка прокрутки (решение 79, по образцу Altitude 101): тонкая шкала
 * у правого края и счётчик процентов, который едет вместе с отметкой.
 * Только на длинных страницах объекта и только с мышью: на телефоне и при
 * «уменьшить движение» не показывается. Обновляется без перерисовки React —
 * напрямую стилем, раз за кадр.
 */
export function ScrollRuler() {
  const markRef = useRef<HTMLSpanElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const max = document.documentElement.scrollHeight - window.innerHeight
      const share = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
      if (rootRef.current) rootRef.current.dataset.idle = max < 200 ? 'true' : 'false'
      if (markRef.current) {
        markRef.current.style.transform = `translateY(${share * 100}%)`
        markRef.current.dataset.value = String(Math.round(share * 100)).padStart(3, '0')
      }
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [])

  return (
    <div ref={rootRef} className={styles.root} aria-hidden>
      <span className={styles.track}>
        <span ref={markRef} className={styles.mark} />
      </span>
    </div>
  )
}
