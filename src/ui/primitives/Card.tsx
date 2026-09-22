'use client'

import Link from 'next/link'
import type { HTMLAttributes, ReactNode } from 'react'
import styles from './Card.module.css'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md' | 'lg'
  muted?: boolean
  /** Карточка ведёт на страницу объекта — кликабельна целиком (раздел 3.2 компонентов). */
  href?: string
  isSelected?: boolean
  children: ReactNode
}

export function Card({
  padding = 'md',
  muted = false,
  href,
  isSelected = false,
  className,
  children,
  ...props
}: CardProps) {
  const classes = [
    styles.card,
    styles[padding],
    muted ? styles.muted : '',
    href ? styles.interactive : '',
    isSelected ? styles.selected : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    )
  }

  return (
    <div className={classes} {...props}>
      {children}
    </div>
  )
}
