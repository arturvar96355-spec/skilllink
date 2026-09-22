'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Icon } from '../primitives/Icon'
import { IconButton } from '../primitives/IconButton'
import styles from './Overlay.module.css'

/**
 * Короткие сообщения о результате действия.
 *
 * Успех исчезает сам, ошибка — нет: сообщение, требующее действия, не должно
 * пропасть раньше, чем его прочитают (раздел 25 документа об интерфейсе).
 */
type ToastKind = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  kind: ToastKind
  text: string
}

interface ToastApi {
  success: (text: string) => void
  error: (text: string) => void
  info: (text: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const AUTO_HIDE_MS = 4000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const remove = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const push = useCallback(
    (kind: ToastKind, text: string) => {
      const id = Date.now() + Math.random()
      setItems((current) => [...current, { id, kind, text }])
      if (kind !== 'error') setTimeout(() => remove(id), AUTO_HIDE_MS)
    },
    [remove],
  )

  const api = useMemo<ToastApi>(
    () => ({
      success: (text) => push('success', text),
      error: (text) => push('error', text),
      info: (text) => push('info', text),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.toasts} role="status" aria-live="polite">
        {items.map((item) => (
          <div
            key={item.id}
            className={[
              styles.toast,
              item.kind === 'success'
                ? styles.toastSuccess
                : item.kind === 'error'
                  ? styles.toastError
                  : styles.toastInfo,
            ].join(' ')}
          >
            <Icon
              name={item.kind === 'success' ? 'check' : item.kind === 'error' ? 'alert' : 'info'}
              size={18}
            />
            <span className={styles.toastText}>{item.text}</span>
            <IconButton icon="close" label="Закрыть сообщение" size="sm" onClick={() => remove(item.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext)
  if (!context) {
    // Провайдер стоит в корне приложения; отсутствие — ошибка сборки экрана.
    throw new Error('useToast вызван вне ToastProvider')
  }
  return context
}
