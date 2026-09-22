'use client'

import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from '../primitives/IconButton'
import { useEscape } from '../hooks/dom'
import styles from './Overlay.module.css'

export interface DrawerProps {
  isOpen: boolean
  onClose: () => void
  title: string
  description?: string
  footer?: ReactNode
  children: ReactNode
}

/**
 * Боковая панель для подробностей, ради которых не стоит уходить с экрана:
 * объяснение рекомендации, просмотр документа, история этапа (раздел 24).
 */
export function Drawer({ isOpen, onClose, title, description, footer, children }: DrawerProps) {
  useEscape(onClose, isOpen)

  useEffect(() => {
    if (!isOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [isOpen])

  if (!isOpen || typeof document === 'undefined') return null

  return createPortal(
    <div
      className={[styles.backdrop, styles.backdropRight].join(' ')}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={title}>
        <div className={styles.head}>
          <div className={styles.titleGroup}>
            <h2 className={styles.title}>{title}</h2>
            {description && <p className={styles.description}>{description}</p>}
          </div>
          <IconButton icon="close" label="Закрыть" size="sm" onClick={onClose} />
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </aside>
    </div>,
    document.body,
  )
}
