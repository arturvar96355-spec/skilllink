'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from '../primitives/IconButton'
import { useEscape } from '../hooks/dom'
import { useFocusTrap } from '../hooks/focus-trap'
import styles from './Overlay.module.css'

export interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  description?: string
  /** Для опасных действий закрытие щелчком по фону отключается (раздел 9.4 компонентов). */
  closeOnBackdrop?: boolean
  wide?: boolean
  footer?: ReactNode
  children: ReactNode
}

/**
 * Модальное окно.
 *
 * Рисуется порталом в конец документа: панели интерфейса используют
 * `backdrop-filter`, а он создаёт собственный контекст наложения, внутри
 * которого никакой z-index не поднимет окно выше шапки.
 */
export function Modal({
  isOpen,
  onClose,
  title,
  description,
  closeOnBackdrop = true,
  wide = false,
  footer,
  children,
}: ModalProps) {
  useEscape(onClose, isOpen)
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, isOpen, 'field')

  // Страница под окном не должна прокручиваться вместе с ним.
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
      className={[styles.backdrop, styles.backdropCenter].join(' ')}
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={[styles.modal, wide ? styles.wide : ''].filter(Boolean).join(' ')}
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
      </div>
    </div>,
    document.body,
  )
}
