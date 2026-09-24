'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { pushEscapeLayer } from './escape-stack'
import { useCalmMotion } from './ui-mode'

/** Закрытие всплывающих окон щелчком вне их области. */
export function useOutsideClick<T extends HTMLElement>(
  onOutside: () => void,
  enabled = true,
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    if (!enabled) return
    function handle(event: MouseEvent) {
      const node = ref.current
      if (node && event.target instanceof Node && !node.contains(event.target)) onOutside()
    }
    // Слушаем нажатие, а не клик: иначе окно закроется уже после того,
    // как сработает элемент под курсором.
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [onOutside, enabled])

  return ref
}

/**
 * Escape закрывает всплывающее окно — требование доступности. Только верхнее:
 * список внутри модального окна закрывается раньше окна (`escape-stack.ts`).
 */
export function useEscape(onEscape: () => void, enabled = true): void {
  // Обработчик читается в момент нажатия: смена функции между отрисовками
  // не должна переносить слой наверх стопки.
  const handler = useRef(onEscape)
  useEffect(() => {
    handler.current = onEscape
  }, [onEscape])

  useEffect(() => {
    if (!enabled) return
    return pushEscapeLayer(() => handler.current())
  }, [enabled])
}

/**
 * Значение, которое «догоняет» ввод с задержкой.
 *
 * Поиск шлёт запрос не на каждую букву: иначе на строке из десяти символов
 * уходит десять запросов, и ответы приходят вперемешку.
 */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}

/** Пользователь просил систему убрать анимации. Живёт рядом с режимом интерфейса. */
export { usePrefersReducedMotion } from './ui-mode'

/** Ширина окна меньше указанной — сайдбар и таблицы перестраиваются. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const media = window.matchMedia(query)
    setMatches(media.matches)
    const handle = (event: MediaQueryListEvent) => setMatches(event.matches)
    media.addEventListener('change', handle)
    return () => media.removeEventListener('change', handle)
  }, [query])

  return matches
}

/**
 * Значение, пережившее перезагрузку страницы.
 *
 * Чтение обёрнуто в try: в приватном окне обращение к хранилищу выбрасывает
 * исключение, и страница не должна из-за этого падать.
 */
export function useStoredValue(key: string, initial: string | null = null) {
  const [value, setValue] = useState<string | null>(initial)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    try {
      setValue(window.localStorage.getItem(key) ?? initial)
    } catch {
      setValue(initial)
    }
    setIsReady(true)
  }, [key, initial])

  const store = useCallback(
    (next: string | null) => {
      setValue(next)
      try {
        if (next === null) window.localStorage.removeItem(key)
        else window.localStorage.setItem(key, next)
      } catch {
        // Хранилище недоступно — значение живёт до перезагрузки, это допустимо.
      }
    },
    [key],
  )

  return { value, store, isReady }
}

/**
 * Счётчик, добегающий от нуля до настоящего значения (раздел 9 документа
 * о движении). Всегда заканчивается на реальном числе: анимация не имеет
 * права показать значение, которого нет в данных.
 */
export function useCountUp(target: number | null, duration = 800): number | null {
  // В рабочем режиме число стоит сразу — аналитик читает его, а не ждёт.
  const reduced = useCalmMotion()
  const [value, setValue] = useState<number | null>(target)

  useEffect(() => {
    if (target === null) {
      setValue(null)
      return
    }
    if (reduced || duration <= 0) {
      setValue(target)
      return
    }

    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1)
      // Замедление к концу: быстрый старт и мягкая остановка.
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(target * eased)
      if (progress < 1) frame = requestAnimationFrame(tick)
      else setValue(target)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, duration, reduced])

  return value
}
