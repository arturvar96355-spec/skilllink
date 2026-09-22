'use client'

import type { ButtonHTMLAttributes } from 'react'
import { Icon, type IconName } from './Icon'
import styles from './IconButton.module.css'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName
  /** Обязательная подпись: у элемента без текста должно быть доступное имя (раздел 33). */
  label: string
  size?: 'sm' | 'md'
  isActive?: boolean
}

export function IconButton({
  icon,
  label,
  size = 'md',
  isActive = false,
  className,
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={[styles.button, styles[size], isActive ? styles.active : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon name={icon} size={size === 'sm' ? 16 : 20} />
    </button>
  )
}
