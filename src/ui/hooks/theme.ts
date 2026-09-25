'use client'

import { useSyncExternalStore } from 'react'
import { THEME_ATTRIBUTE, THEME_KEY, readStoredTheme, resolveTheme, writeTheme, type Theme } from '../lib/theme'

/** Смена темы в этой вкладке; другие вкладки узнают через `storage`. */
const CHANGE_EVENT = 'skilllink:theme'
const SYSTEM_QUERY = '(prefers-color-scheme: light)'

function safeStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function systemPrefersLight(): boolean {
  try {
    return window.matchMedia(SYSTEM_QUERY).matches
  } catch {
    return false
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute(THEME_ATTRIBUTE, theme)
}

function snapshot(): Theme {
  const attribute = document.documentElement.getAttribute(THEME_ATTRIBUTE)
  if (attribute === 'dark' || attribute === 'light') return attribute
  return resolveTheme(readStoredTheme(safeStorage()), systemPrefersLight())
}

function serverSnapshot(): Theme {
  return 'dark'
}

function subscribe(onChange: () => void): () => void {
  const sync = () => {
    applyTheme(resolveTheme(readStoredTheme(safeStorage()), systemPrefersLight()))
    onChange()
  }
  // Выбор в другой вкладке и смена темы системы (если человек не выбирал сам).
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === THEME_KEY) sync()
  }
  const media = window.matchMedia(SYSTEM_QUERY)
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('storage', onStorage)
  media.addEventListener('change', sync)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onStorage)
    media.removeEventListener('change', sync)
  }
}

/**
 * Сменить тему: запомнить и применить. Переход — через View Transitions там,
 * где они есть: новая тема растекается кругом от кнопки, а не мигает весь экран.
 */
export function setTheme(theme: Theme, origin?: { x: number; y: number }): void {
  const apply = () => {
    writeTheme(safeStorage(), theme)
    applyTheme(theme)
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const doc = document as Document & { startViewTransition?: (callback: () => void) => { ready: Promise<void> } }
  if (!doc.startViewTransition || reduced) {
    apply()
    return
  }
  const x = origin?.x ?? window.innerWidth - 80
  const y = origin?.y ?? 32
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
  document.documentElement.dataset.themeSwitch = ''
  const transition = doc.startViewTransition(apply)
  transition.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 520, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' },
      )
    })
    .catch(() => undefined)
    .finally(() => {
      window.setTimeout(() => delete document.documentElement.dataset.themeSwitch, 600)
    })
}

/** Тема интерфейса (решение 103): одна на всё приложение и все вкладки. */
export function useTheme(): { theme: Theme; setTheme: typeof setTheme } {
  const theme = useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  return { theme, setTheme }
}
