'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  DEFAULT_UI_MODE,
  UI_MODE_ATTRIBUTE,
  UI_MODE_KEY,
  parseUiMode,
  readUiMode,
  writeUiMode,
  type UiMode,
} from '../lib/ui-mode'

/** Событие смены режима в этой вкладке; другие вкладки узнают через `storage`. */
const CHANGE_EVENT = 'skilllink:ui-mode'

/** Само обращение к `localStorage` бросает исключение в приватном окне. */
function safeStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function applyMode(mode: UiMode): void {
  document.documentElement.setAttribute(UI_MODE_ATTRIBUTE, mode)
}

/**
 * Текущий режим — атрибут на `<html>`: его ставит скрипт до первой отрисовки
 * (`UI_MODE_BOOT_SCRIPT`) и меняет `setUiMode`. Атрибута нет — скрипт не
 * выполнился, тогда читается хранилище.
 */
function snapshot(): UiMode {
  const attribute = document.documentElement.getAttribute(UI_MODE_ATTRIBUTE)
  return attribute ? parseUiMode(attribute) : readUiMode(safeStorage())
}

function serverSnapshot(): UiMode {
  return DEFAULT_UI_MODE
}

function subscribe(onChange: () => void): () => void {
  // Режим сменили в другой вкладке — эта подстраивается сама.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== UI_MODE_KEY) return
    applyMode(readUiMode(safeStorage()))
    onChange()
  }
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onStorage)
  }
}

/** Сменить режим: запомнить, поставить атрибут, известить компоненты. */
export function setUiMode(mode: UiMode): void {
  // Не сохранилось (приватное окно) — режим действует до перезагрузки.
  writeUiMode(safeStorage(), mode)
  applyMode(mode)
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

/**
 * Режим интерфейса (решение 80). Один на всё приложение и все вкладки:
 * переключатель в шапке и в настройках меняет его сразу везде.
 */
export function useUiMode(): { mode: UiMode; isWork: boolean; setMode: (mode: UiMode) => void } {
  const mode = useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  return { mode, isWork: mode === 'work', setMode: setUiMode }
}

/** Пользователь просил систему убрать анимации. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(query.matches)
    const handle = (event: MediaQueryListEvent) => setReduced(event.matches)
    query.addEventListener('change', handle)
    return () => query.removeEventListener('change', handle)
  }, [])

  return reduced
}

/**
 * Спокойное движение: человек просил систему убрать анимации или выбран
 * рабочий режим. Декоративное движение (рассыпка букв, рост колец, импульсы
 * по проводам, пружины бирок, счётчики) проверяет это, а не одно
 * `prefers-reduced-motion`.
 */
export function useCalmMotion(): boolean {
  const reduced = usePrefersReducedMotion()
  const { isWork } = useUiMode()
  return reduced || isWork
}
