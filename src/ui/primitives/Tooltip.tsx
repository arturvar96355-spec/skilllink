'use client'

import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styles from './Tooltip.module.css'

export interface TooltipProps {
  /** Текст подсказки. Обычно это `explanation` показателя — откуда взялось число. */
  text: string
  children: ReactNode
}

/** Отступ подсказки от края окна и от того, к чему она относится. */
const GAP = 8

/**
 * Подсказка при наведении и при фокусе с клавиатуры.
 *
 * Раньше пузырь всегда лежал на странице, просто прозрачный, и стоял по центру
 * над значком. У правого края он выходил за окно: страница получала
 * горизонтальную прокрутку (личный кабинет на 1280 — на 20 px), а при наведении
 * текст обрезался краем экрана; в ячейке таблицы его обрезала сама ячейка.
 * Теперь пузырь появляется только открытым, закреплён относительно окна
 * (`position: fixed` — не раздвигает страницу и не зависит от обрезки
 * контейнера), вынесен в body и сдвигается так, чтобы целиком оставаться в окне.
 */
export function Tooltip({ text, children }: TooltipProps) {
  const id = useId()
  const triggerRef = useRef<HTMLSpanElement>(null)
  const bubbleRef = useRef<HTMLSpanElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => {
    setIsOpen(false)
    setPosition(null)
  }, [])

  useLayoutEffect(() => {
    if (!isOpen) return
    const trigger = triggerRef.current?.getBoundingClientRect()
    const bubble = bubbleRef.current?.getBoundingClientRect()
    if (!trigger || !bubble) return
    const maxLeft = window.innerWidth - bubble.width - GAP
    const centered = trigger.left + trigger.width / 2 - bubble.width / 2
    const left = Math.max(GAP, Math.min(centered, maxLeft))
    const above = trigger.top - bubble.height - GAP
    // Места сверху нет — под значком.
    const top = above >= GAP ? above : trigger.bottom + GAP
    setPosition({ left, top })
  }, [isOpen, text])

  // Прокрутка уводит значок из-под пузыря — закрываем, а не держим в воздухе.
  useLayoutEffect(() => {
    if (!isOpen) return
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [isOpen, close])

  return (
    <span
      className={styles.wrapper}
      onPointerEnter={open}
      onPointerLeave={close}
      onFocus={open}
      onBlur={close}
    >
      <span
        ref={triggerRef}
        className={styles.trigger}
        tabIndex={0}
        role="button"
        aria-label={text}
        aria-describedby={isOpen ? id : undefined}
      >
        {children}
      </span>
      {/* В body, а не рядом со значком: у обёрток страницы бывает transform
          (анимация появления), и внутри них fixed считается от обёртки, а не от окна. */}
      {isOpen &&
        createPortal(
        <span
          ref={bubbleRef}
          id={id}
          role="tooltip"
          className={styles.bubble}
          style={
            position
              ? { left: position.left, top: position.top }
              : // Первый кадр — только чтобы измерить размер, невидимо.
                { left: 0, top: 0, visibility: 'hidden' }
          }
        >
          {text}
        </span>,
          document.body,
        )}
    </span>
  )
}
