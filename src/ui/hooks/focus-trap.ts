'use client'

import { useEffect, type RefObject } from 'react'

/**
 * Фокус внутри модального окна.
 *
 * Окна объявляли себя модальными (`aria-modal`), но фокус не забирали: после
 * открытия «Создать связку» Tab уводил на пункт меню «Главная» под окном,
 * и с клавиатуры человек работал со страницей за окном, а не с формой.
 * Теперь окно при открытии ставит фокус на первое поле, Tab и Shift+Tab ходят
 * по кругу внутри, а при закрытии фокус возвращается туда, откуда окно открыли.
 * Удерживает фокус только верхнее окно — как и Escape (`escape-stack.ts`).
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Куда перейти по Tab из позиции `current` среди `count` элементов. -1 — фокус снаружи. */
export function nextFocusIndex(count: number, current: number, backwards: boolean): number {
  if (count === 0) return -1
  if (current === -1) return backwards ? count - 1 : 0
  return backwards ? (current - 1 + count) % count : (current + 1) % count
}

const traps: HTMLElement[] = []

function focusables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.getClientRects().length > 0 && !element.closest('[aria-hidden="true"]'),
  )
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Tab') return
  const container = traps[traps.length - 1]
  if (!container) return
  const items = focusables(container)
  const current = items.indexOf(document.activeElement as HTMLElement)
  // Внутри окна и не на краю — браузер переведёт фокус сам.
  const atEdge = event.shiftKey ? current <= 0 : current === items.length - 1 || current === -1
  if (!atEdge) return
  event.preventDefault()
  const next = nextFocusIndex(items.length, current, event.shiftKey)
  if (next === -1) container.focus()
  else items[next]?.focus()
}

/**
 * `initial`: `field` — фокус на первое поле (форма открыта, чтобы её заполнить);
 * `container` — на само окно (боковая панель открыта, чтобы её прочитать).
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  initial: 'field' | 'container' = 'field',
): void {
  useEffect(() => {
    const container = ref.current
    if (!active || !container) return

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    traps.push(container)
    if (traps.length === 1) document.addEventListener('keydown', onKeyDown)

    // Первое поле формы, а не кнопка «Закрыть» в заголовке: открыли форму,
    // чтобы её заполнить. Поле с autoFocus уже получило фокус — его не трогаем.
    if (!container.contains(document.activeElement)) {
      const items = focusables(container)
      const first = items.find((element) => !element.hasAttribute('data-dialog-close'))
      if (initial === 'field' && first) first.focus()
      else container.focus()
    }

    return () => {
      const index = traps.lastIndexOf(container)
      if (index >= 0) traps.splice(index, 1)
      if (traps.length === 0) document.removeEventListener('keydown', onKeyDown)
      if (opener && opener.isConnected) opener.focus()
    }
  }, [ref, active, initial])
}
