'use client'

import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useMediaQuery } from '../hooks/dom'
import styles from './Tooltip.module.css'

export interface TooltipProps {
  /** Текст подсказки. Обычно это `explanation` показателя — откуда взялось число. */
  text: string
  children: ReactNode
  /**
   * Не показывать вовсе — например, текст внутри и так виден целиком, не обрезан
   * (решение 140, п. 7): подсказка с тем же текстом только закрывала бы соседний
   * текст карточки, ничего не добавляя.
   */
  disabled?: boolean
  /**
   * По умолчанию — да: значок или сокращение, до которого не добраться иначе,
   * получает свою точку фокуса и роль «кнопка», а текст подсказки становится
   * его именем для программ чтения с экрана.
   *
   * `false` — для обрезанного текста, который сам уже полностью виден программе
   * чтения с экрана (обрезка только визуальная), и который часто лежит внутри
   * своей ссылки или другого интерактивного элемента: вложенная точка фокуса
   * там была бы второй, лишней остановкой Tab на то же самое (решение 140, п. 7).
   * Подсказка в этом случае — только по наведению мышью.
   */
  interactive?: boolean
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
export function Tooltip({ text, children, disabled = false, interactive = true }: TooltipProps) {
  const id = useId()
  const triggerRef = useRef<HTMLSpanElement>(null)
  const bubbleRef = useRef<HTMLSpanElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  // На сенсорном экране некому наводиться, а тап по фокусируемому элементу
  // не должен открывать всплывающий текст — на телефоне он только закрывал бы
  // соседний текст карточки, и закрыть его нечем, кроме тапа мимо (решение 140, п. 7).
  const canHover = useMediaQuery('(hover: hover) and (pointer: fine)')
  const show = !disabled && canHover

  const open = useCallback(() => {
    if (show) setIsOpen(true)
  }, [show])
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
      onFocus={interactive ? open : undefined}
      onBlur={interactive ? close : undefined}
    >
      <span
        ref={triggerRef}
        className={styles.trigger}
        tabIndex={interactive ? 0 : undefined}
        role={interactive ? 'button' : undefined}
        aria-label={interactive ? text : undefined}
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
