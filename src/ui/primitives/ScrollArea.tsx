'use client'

import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react'
import { IconButton } from './IconButton'
import styles from './ScrollArea.module.css'

/**
 * Полоса, которая на узком экране листается вбок (решение 195).
 *
 * Вкладки, разделы настроек, степпер этапов, таблицы, граф вуза: раньше у всех
 * было голое `overflow-x: auto` — содержимое упиралось в край ровным обрезом,
 * и человек решал, что это всё («Пользователи» и «Журнал действий» у
 * администратора так и не находились). Здесь один приём на всё:
 *
 * - край, за которым есть ещё, растворяется (маска, а не цветная плашка —
 *   фон под полосой бывает любой, обе темы);
 * - у этого края — кнопка-шеврон: видимый признак, что полоса едет, и способ
 *   пролистать мышью, у которой нет жеста вбок;
 * - когда всё помещается, нет ни маски, ни кнопок — десктоп выглядит как раньше.
 *
 * Состояние краёв пишется атрибутами на рамку, без перерисовки React на каждом
 * кадре прокрутки. Шевроны скрыты от чтения с экрана и из обхода Tab: полосу
 * листают сами элементы в фокусе, а область без своих кнопок и ссылок
 * (таблица отчёта) получает фокус сама — по `label`.
 */
export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  /** Классы рамки — внешнего блока, в котором стоят шевроны. */
  frameClassName?: string
  /**
   * Где шевроны по вертикали: `center` — у низкой полосы (вкладки, разделы),
   * `start` — у высокой (таблица, граф): у шапки таблицы, а при прокрутке
   * страницы — под её шапкой, пока таблица на экране.
   */
  edges?: 'center' | 'start'
  /**
   * Подпись области. Задана — полоса становится именованной областью, а когда
   * листается — ещё и получает фокус: её листают стрелками с клавиатуры.
   * Нужна там, где внутри нет своих кнопок и ссылок.
   */
  label?: string
  /**
   * Выбранный элемент полосы (`[aria-selected='true']`, `[aria-current='page']`):
   * при открытии и смене выбора полоса доезжает до него сама — раздел, открытый
   * по адресу `#users`, не остаётся за краем.
   */
  revealSelector?: string
  /** Меняется — полоса снова доезжает до выбранного. */
  revealKey?: string
  /**
   * Куда ставить выбранный: `nearest` — ровно до видимой части (вкладки),
   * `center` — в середину (текущий этап ленты: видно и пройденное, и следующее).
   */
  revealAlign?: 'nearest' | 'center'
}

/**
 * Сколько содержимого должно прятаться за краем, чтобы это считалось «есть ещё».
 * Меньше — это выступ, а не содержимое: тень строки, этап ленты, выдвинутый
 * в 3D. На 1440 лента этапов выступала на 8 px и получала шеврон впустую.
 */
const MIN_HIDDEN = 24
/** Запас у края: дробная прокрутка на экранах 3× и тот же выступ не дают ровного нуля. */
const EDGE_EPSILON = 12

export function ScrollArea({
  children,
  frameClassName,
  className,
  edges = 'center',
  label,
  revealSelector,
  revealKey,
  revealAlign = 'nearest',
  ...props
}: ScrollAreaProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const frame = frameRef.current
    const scroller = scrollRef.current
    if (!frame || !scroller) return

    const focusable = Boolean(label)
    let frameId = 0
    const update = () => {
      frameId = 0
      const max = scroller.scrollWidth - scroller.clientWidth
      // Вид, который вбок не листается (лента реестра, карточки на телефоне),
      // может выступать за край тенью или меткой — это не «есть ещё».
      const scrolls = max > MIN_HIDDEN && getComputedStyle(scroller).overflowX !== 'visible'
      frame.toggleAttribute('data-more-start', scrolls && scroller.scrollLeft > EDGE_EPSILON)
      frame.toggleAttribute('data-more-end', scrolls && scroller.scrollLeft < max - EDGE_EPSILON)
      // Фокус — только у полосы, которая и правда листается: на широком экране
      // таблица помещается, и лишняя остановка Tab ей не нужна.
      if (focusable) {
        if (scrolls) scroller.setAttribute('tabindex', '0')
        else scroller.removeAttribute('tabindex')
      }
    }
    const schedule = () => {
      if (!frameId) frameId = requestAnimationFrame(update)
    }

    // Ширина содержимого меняется без изменения размера полосы (пришли данные,
    // счётчик на вкладке): следим и за детьми, а новых детей подхватываем.
    const resize = new ResizeObserver(schedule)
    const observeChildren = () => {
      resize.disconnect()
      resize.observe(scroller)
      for (const child of Array.from(scroller.children)) resize.observe(child)
      schedule()
    }
    const mutations = new MutationObserver(observeChildren)

    observeChildren()
    mutations.observe(scroller, { childList: true })
    scroller.addEventListener('scroll', schedule, { passive: true })
    return () => {
      if (frameId) cancelAnimationFrame(frameId)
      resize.disconnect()
      mutations.disconnect()
      scroller.removeEventListener('scroll', schedule)
    }
  }, [label])

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || !revealSelector) return
    const target = scroller.querySelector<HTMLElement>(revealSelector)
    if (!target) return
    // Только вбок и только внутри полосы: scrollIntoView дёрнул бы и страницу.
    const box = scroller.getBoundingClientRect()
    const item = target.getBoundingClientRect()
    if (revealAlign === 'center') {
      scroller.scrollLeft += item.left + item.width / 2 - (box.left + box.width / 2)
      return
    }
    const fade = parseFloat(getComputedStyle(scroller).getPropertyValue('--scroll-fade-size')) || 0
    if (item.left < box.left + fade) scroller.scrollLeft += item.left - box.left - fade
    else if (item.right > box.right - fade) scroller.scrollLeft += item.right - box.right + fade
  }, [revealSelector, revealKey, revealAlign])

  function page(direction: -1 | 1) {
    const scroller = scrollRef.current
    if (!scroller) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    scroller.scrollBy({ left: direction * scroller.clientWidth * 0.8, behavior: reduce ? 'auto' : 'smooth' })
  }

  return (
    <div
      ref={frameRef}
      className={[styles.frame, edges === 'start' ? styles.edgesStart : '', frameClassName ?? '']
        .filter(Boolean)
        .join(' ')}
    >
      {/*
        Шевроны — на своей направляющей: у высокой полосы она липнет под шапкой
        страницы, и шеврон виден, пока видна таблица, а не только её верх.
      */}
      <div className={styles.rail}>
        <IconButton
          icon="chevronLeft"
          label="Пролистать назад"
          size="sm"
          className={[styles.edge, styles.edgePrev].join(' ')}
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => page(-1)}
        />
        <IconButton
          icon="chevronRight"
          label="Пролистать дальше"
          size="sm"
          className={[styles.edge, styles.edgeNext].join(' ')}
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => page(1)}
        />
      </div>
      <div
        ref={scrollRef}
        className={[styles.scroll, className ?? ''].filter(Boolean).join(' ')}
        {...(label ? { role: 'region', 'aria-label': label } : null)}
        {...props}
      >
        {children}
      </div>
    </div>
  )
}
