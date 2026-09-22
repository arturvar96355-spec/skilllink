'use client'

import type { ReactNode } from 'react'
import styles from './Tooltip.module.css'

export interface TooltipProps {
  /** Текст подсказки. Обычно это `explanation` показателя — откуда взялось число. */
  text: string
  children: ReactNode
}

export function Tooltip({ text, children }: TooltipProps) {
  return (
    <span className={styles.wrapper}>
      <span className={styles.trigger} tabIndex={0} role="button" aria-label={text}>
        {children}
      </span>
      <span className={styles.bubble} role="tooltip">
        {text}
      </span>
    </span>
  )
}
