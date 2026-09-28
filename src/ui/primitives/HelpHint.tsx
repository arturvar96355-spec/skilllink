'use client'

import Link from 'next/link'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { helpEntry, type HelpRef } from '@/shared/help/tools'
import { useEscape, useMediaQuery } from '../hooks/dom'
import { Icon } from './Icon'
import tooltipStyles from './Tooltip.module.css'
import styles from './HelpHint.module.css'

/** Отступ окошка от края экрана и от значка — как у `Tooltip`. */
const GAP = 8
/** Наведение открывает не сразу: курсор, пролетевший мимо, окно не дёргает. */
const HOVER_OPEN_MS = 180
/** И закрывает не сразу: курсор успевает перейти со значка на ссылку в окне. */
const HOVER_CLOSE_MS = 220

/**
 * Раздел документации — ключ реестра `shared/help` — и, если «?» стоит у
 * конкретной кнопки или блока, его подраздел (`tools.ts`, решение 217).
 * Неизвестный раздел и подраздел чужого раздела — ошибка типов.
 */
export type HelpHintProps = HelpRef & {
  /**
   * Как читать числа и пометки именно этого экрана — строка, которая раньше
   * стояла отдельным `InfoHint` рядом (решение 217): два «?» у одного заголовка
   * не ставим, пояснение переезжает в окошко документации.
   */
  note?: string
  /**
   * Вместо «как пользоваться» — тому, кто этим пользоваться не может (решение 232):
   * эксперту хакатона «отметьте пункт флажком» у неактивного флажка читалось как
   * ошибка. Строка объясняет, почему действие недоступно и где его увидеть.
   */
  readOnly?: string
}

/**
 * «?» рядом с инструментом со ссылкой в документацию (решение 214).
 *
 * Тот же значок и тот же пузырь, что у `InfoHint` (решение 211), — классы
 * `Tooltip.module.css`: третьего вида «?» в системе нет. Разница в содержимом:
 * заголовок раздела, `short` — что это, `how` — как пользоваться, и ссылка
 * «Подробнее в документации →». Текст — из реестра `shared/help/topics.ts`
 * (у кнопки или блока — подраздел из `tools.ts`, решение 217),
 * того же, из которого собраны `/docs`, `/help` и `docs/USER_GUIDE.md`.
 *
 * Поэтому это не подсказка (`role="tooltip"` не может содержать ссылку), а
 * маленькое немодальное окно: открывается нажатием — и на компьютере ещё
 * наведением, — закрывается Esc, нажатием вне и уходом курсора. Открытое
 * с клавиатуры или нажатием получает фокус, чтобы Tab дошёл до ссылки;
 * Esc возвращает фокус на значок. Окно в body и прижато к окну браузера —
 * на телефоне края экрана его не режут.
 *
 * Ссылка ведёт в справку внутри системы (`/help#<раздел>`), а не на `/docs`:
 * подсказка бывает только на экранах системы, и переход остаётся в каркасе —
 * без перезагрузки, с шапкой и кнопкой «Назад». Текст там тот же, что на `/docs`.
 */
export function HelpHint(props: HelpHintProps) {
  const entry = helpEntry(props)
  const panelId = useId()
  const titleId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const openTimer = useRef<number | null>(null)
  const closeTimer = useRef<number | null>(null)
  // `pinned` — открыто нажатием: уход курсора его не закрывает.
  const [state, setState] = useState<'closed' | 'hover' | 'pinned'>('closed')
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const canHover = useMediaQuery('(hover: hover) and (pointer: fine)')
  const isOpen = state !== 'closed'

  const clearTimers = useCallback(() => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current)
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    openTimer.current = null
    closeTimer.current = null
  }, [])

  const close = useCallback(
    (returnFocus: boolean) => {
      clearTimers()
      setState('closed')
      setPosition(null)
      if (returnFocus) triggerRef.current?.focus()
    },
    [clearTimers],
  )

  useEffect(() => clearTimers, [clearTimers])

  // Место окошка: над значком, если сверху хватает места, иначе под ним;
  // по горизонтали — по центру значка, но не за краем окна.
  const place = useCallback(() => {
    const trigger = triggerRef.current?.getBoundingClientRect()
    const panel = panelRef.current?.getBoundingClientRect()
    if (!trigger || !panel) return
    const maxLeft = window.innerWidth - panel.width - GAP
    const centered = trigger.left + trigger.width / 2 - panel.width / 2
    const left = Math.max(GAP, Math.min(centered, maxLeft))
    const above = trigger.top - panel.height - GAP
    const below = trigger.bottom + GAP
    const fitsBelow = below + panel.height <= window.innerHeight - GAP
    const top = above >= GAP ? above : fitsBelow ? below : Math.max(GAP, window.innerHeight - panel.height - GAP)
    setPosition({ left, top })
  }, [])

  useLayoutEffect(() => {
    if (!isOpen) return
    place()
  }, [isOpen, place])

  // Прокрутка и смена размера окна двигают значок — окошко едет следом, а не висит в воздухе.
  useEffect(() => {
    if (!isOpen) return
    let frame = 0
    const follow = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(place)
    }
    window.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('resize', follow)
    }
  }, [isOpen, place])

  // Открыто нажатием — фокус в окошко: следующий Tab попадёт на ссылку. Только после
  // того, как окошко встало на место: в первом кадре оно невидимо (замер), и фокус
  // на невидимый элемент браузер не ставит.
  const placed = position !== null
  useEffect(() => {
    if (state === 'pinned' && placed) panelRef.current?.focus({ preventScroll: true })
  }, [state, placed])

  // Нажатие вне значка и окошка закрывает.
  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      close(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [isOpen, close])

  useEscape(() => close(true), isOpen)

  function onPointerEnter() {
    if (!canHover) return
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = null
    if (state !== 'closed' || openTimer.current !== null) return
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null
      setState((current) => (current === 'closed' ? 'hover' : current))
    }, HOVER_OPEN_MS)
  }

  function onPointerLeave() {
    if (!canHover) return
    if (openTimer.current !== null) window.clearTimeout(openTimer.current)
    openTimer.current = null
    if (state !== 'hover') return
    closeTimer.current = window.setTimeout(() => close(false), HOVER_CLOSE_MS)
  }

  function onClick() {
    clearTimers()
    if (state === 'pinned') close(false)
    else setState('pinned')
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={[tooltipStyles.trigger, styles.trigger].join(' ')}
        aria-label={`Что такое «${entry.title}»`}
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        aria-haspopup="dialog"
        onClick={onClick}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      >
        <span className={tooltipStyles.hintIcon}>
          <Icon name="help" size={16} />
        </span>
      </button>
      {isOpen &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-labelledby={titleId}
            // Окошко лежит в body, а открыто из меню, колокольчика или модального окна:
            // по этой пометке их «нажатие вне» и удержание фокуса считают его своим.
            data-floating-layer=""
            tabIndex={-1}
            className={[tooltipStyles.bubble, styles.panel].join(' ')}
            style={position ? { left: position.left, top: position.top } : { left: 0, top: 0, visibility: 'hidden' }}
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
            onBlur={(event) => {
              const next = event.relatedTarget as Node | null
              if (next && (panelRef.current?.contains(next) || triggerRef.current?.contains(next))) return
              // Tab ушёл за ссылку — в конец страницы, где окошко лежит в body: фокус
              // возвращается на значок, чтобы следующий Tab шёл дальше по экрану.
              close(next === null)
            }}
          >
            <span id={titleId} className={styles.title}>
              {entry.title}
            </span>
            <span className={styles.text}>{entry.short}</span>
            {props.note && <span className={styles.text}>{props.note}</span>}
            <span className={styles.text}>{props.readOnly ?? entry.how}</span>
            <Link href={entry.href} className={styles.more} onClick={() => close(false)}>
              Подробнее в документации
              <Icon name="arrowRight" size={16} />
            </Link>
          </div>,
          document.body,
        )}
    </>
  )
}
