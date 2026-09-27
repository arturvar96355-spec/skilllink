'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { usePrefersReducedMotion } from '../hooks/ui-mode'
import { isDragGesture, wrapTrackOffset } from './ticker-track'
import styles from './Ticker.module.css'

/**
 * Бегущая строка событий (решение 79, доработка решением 186).
 *
 * Лента повторена дважды и уезжает на свою ширину — шов не виден. Положение
 * ведёт `requestAnimationFrame`, а не CSS-анимация: только так строку можно
 * остановить и перетащить без прыжка на начало. Наведение мыши или фокус
 * ставит ленту на паузу; пока она стоит, её можно тащить мышью или пальцем
 * (`pointer events`) в любую сторону — перетаскивание за край заворачивает
 * содержимое (`wrapTrackOffset`), петля остаётся бесшовной. После ухода мыши
 * или отпускания лента едет дальше с того же места. Перетаскивание — только
 * по горизонтали (`touch-action: pan-y`), вертикальная прокрутка страницы
 * пальцем не ломается. При «уменьшить движение» автопрокрутки нет, но лента
 * по-прежнему тащится руками. Клик по ссылке без сдвига (`isDragGesture`,
 * порог ~5px) — обычный переход, не перетаскивание.
 */
export interface TickerItem {
  key: string
  text: string
  href: string
  tone: 'danger' | 'warning' | 'info'
}

/** Больше этого расстояния — уже перетаскивание, не клик по ссылке. */
const CLICK_THRESHOLD_PX = 5

export function Ticker({ items, label }: { items: TickerItem[]; label: string }) {
  const reducedMotion = usePrefersReducedMotion()
  const trackRef = useRef<HTMLDivElement | null>(null)

  /** Ширина одной копии ленты — перетаскивание и автопрокрутка заворачиваются по ней. */
  const loopWidthRef = useRef(0)
  /** Скорость автопрокрутки, пикселей в миллисекунду. */
  const speedRef = useRef(0)
  /** Текущее смещение ленты (`translateX`), пикселей. */
  const positionRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)

  const hoveredRef = useRef(false)
  const focusedRef = useRef(false)
  const draggingRef = useRef(false)
  const reducedRef = useRef(false)
  reducedRef.current = reducedMotion

  const dragRef = useRef<{ pointerId: number; x: number; y: number; startPosition: number } | null>(null)
  /** Перетаскивание превысило порог клика — следующий click по ссылке гасится. */
  const draggedRef = useRef(false)

  const [isDragging, setIsDragging] = useState(false)

  // Скорость — от длины ленты: короткая не должна мелькать, длинная — ползти.
  const duration = Math.max(30, items.reduce((sum, item) => sum + item.text.length, 0) * 0.28)

  const applyTransform = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    positionRef.current = wrapTrackOffset(positionRef.current, loopWidthRef.current)
    track.style.transform = `translate3d(${positionRef.current}px, 0, 0)`
  }, [])

  // Ширина одной копии ленты — при первом рендере и при смене событий/размера окна.
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const measure = () => {
      loopWidthRef.current = track.scrollWidth / 2
      speedRef.current = loopWidthRef.current > 0 ? loopWidthRef.current / (duration * 1000) : 0
      applyTransform()
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(track)
    return () => observer.disconnect()
  }, [items, duration, applyTransform])

  // Один непрерывный цикл кадров на весь срок жизни компонента: пауза
  // и перетаскивание только пропускают шаг автопрокрутки, но не сбрасывают
  // счётчик времени — после них позиция едет дальше без скачка.
  useEffect(() => {
    const tick = (timestamp: number) => {
      const delta = lastFrameRef.current === null ? 0 : timestamp - lastFrameRef.current
      lastFrameRef.current = timestamp
      const paused = reducedRef.current || hoveredRef.current || focusedRef.current || draggingRef.current
      if (!paused && delta > 0) {
        positionRef.current -= speedRef.current * delta
      }
      applyTransform()
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      lastFrameRef.current = null
    }
  }, [applyTransform])

  function onPointerEnter(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== 'mouse') return
    hoveredRef.current = true
  }

  function onPointerLeave(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== 'mouse') return
    hoveredRef.current = false
  }

  function onFocus() {
    focusedRef.current = true
  }

  function onBlur() {
    focusedRef.current = false
  }

  /**
   * Нажатие ставит автопрокрутку на паузу сразу, но `setPointerCapture` — только
   * когда движение превысит порог клика (`onPointerMove`). Схваченный курсором
   * элемент получает и следующий за перетаскиванием `click`: если поймать
   * указатель уже здесь, обычный щелчок по ссылке перестаёт доходить до нее
   * (замечено на `TagCarousel.tsx` — тот же приём и та же причина).
   */
  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startPosition: positionRef.current,
    }
    draggingRef.current = true
    draggedRef.current = false
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (!draggedRef.current && isDragGesture(dx, dy, CLICK_THRESHOLD_PX)) {
      draggedRef.current = true
      setIsDragging(true)
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    positionRef.current = drag.startPosition + dx
  }

  function endDrag(event: PointerEvent<HTMLElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    draggingRef.current = false
    setIsDragging(false)
  }

  /** Клик, которым закончилось перетаскивание, ссылку не открывает (порог CLICK_THRESHOLD_PX). */
  function onClickCapture(event: MouseEvent<HTMLElement>) {
    if (!draggedRef.current) return
    draggedRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  if (items.length === 0) return null

  const track = (hidden: boolean) =>
    items.map((item) => (
      <Link
        key={`${hidden ? 'b' : 'a'}-${item.key}`}
        href={item.href}
        className={`${styles.item} ${styles[item.tone]}`}
        tabIndex={hidden ? -1 : undefined}
        aria-hidden={hidden || undefined}
        // Ссылку браузер по умолчанию «берёт» как перетаскиваемый объект: зажал и
        // повёл — начинается перенос ссылки, приходит pointercancel, и лента не
        // тянется, а только останавливается (замечено владельцем 27.09).
        draggable={false}
      >
        <span className={styles.dot} aria-hidden />
        {item.text}
      </Link>
    ))

  return (
    <section
      className={`${styles.root} ${isDragging ? styles.dragging : ''}`}
      aria-label={label}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClickCapture={onClickCapture}
      onDragStart={(event) => event.preventDefault()}
    >
      <div ref={trackRef} className={styles.track}>
        {track(false)}
        {track(true)}
      </div>
    </section>
  )
}
