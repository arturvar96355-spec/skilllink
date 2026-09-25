'use client'

import { useRef, type CSSProperties } from 'react'
import { useInView } from 'motion/react'
import styles from './StageBar.module.css'

/**
 * Полоска маршрута связки из 14 делений (решение 87) — та же лента этапов, что
 * на карточке связки, но в строку списка. Закрытые деления заливаются волной
 * слева направо, текущий этап — фирменным цветом, если связка встала — красным
 * (просрочка) или жёлтым (блок). Какие именно этапы просрочены, список не знает —
 * поэтому цветом отмечен только текущий, а не выдуманные деления.
 */
export function StageBar({
  done,
  current,
  total = 14,
  state,
  delay = 0,
}: {
  /** Сколько этапов закрыто или отменено. */
  done: number
  /** Номер текущего этапа; `null` — все пройдены. */
  current: number | null
  total?: number
  state: 'ok' | 'overdue' | 'blocked'
  /** Задержка волны, мс — чтобы строки заливались одна за другой. */
  delay?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '0px 0px -5% 0px' })

  return (
    <span
      ref={ref}
      className={styles.bar}
      data-inview={inView || undefined}
      style={{ '--delay': `${delay}ms` } as CSSProperties}
      aria-hidden
    >
      {Array.from({ length: total }, (_, index) => {
        const number = index + 1
        const kind =
          number === current ? (state === 'ok' ? styles.current : styles[state]) : index < done ? styles.done : ''
        return <span key={index} className={[styles.cell, kind].filter(Boolean).join(' ')} style={{ '--c': index } as CSSProperties} />
      })}
    </span>
  )
}
