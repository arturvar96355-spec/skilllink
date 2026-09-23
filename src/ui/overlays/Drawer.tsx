'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from '../primitives/IconButton'
import { useEscape } from '../hooks/dom'
import { useFocusTrap } from '../hooks/focus-trap'
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
  const dialogRef = useRef<HTMLElement>(null)
  useFocusTrap(dialogRef, isOpen, 'container')

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
      <aside
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className={styles.head}>
          <div className={styles.titleGroup}>
            <h2 className={styles.title}>{title}</h2>
            {description && <p className={styles.description}>{description}</p>}
          </div>
          <IconButton icon="close" label="Закрыть" size="sm" onClick={onClose} data-dialog-close />
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </aside>
    </div>,
    document.body,
  )
}
