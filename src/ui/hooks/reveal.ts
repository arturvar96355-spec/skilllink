'use client'

import { useEffect, useState, type RefObject } from 'react'

/**
 * «Элемент дошёл до экрана» — один раз (решение 88). По нему графики главной
 * запускают появление.
 *
 * Основной путь — IntersectionObserver. Запасной — сверка положения при
 * монтировании, прокрутке и раз в 300 мс, пока элемент не показан: встречаются
 * окружения, где наблюдатель молчит (фоновая вкладка, встроенные просмотрщики),
 * а элемент въезжает в экран без прокрутки — когда выше догружаются блоки.
 * Без этого график навсегда оставался пустым. Пусть лучше появится без повода,
 * чем не появится совсем.
 */
export function useReveal(ref: RefObject<Element | null>, threshold = 0.9): boolean {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (shown) return
    const element = ref.current
    if (!element) return

    const inside = () => {
      const rect = element.getBoundingClientRect()
      return rect.top < window.innerHeight * threshold && rect.bottom > 0
    }
    if (inside()) {
      setShown(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setShown(true)
      },
      { rootMargin: `0px 0px -${Math.round((1 - threshold) * 100)}% 0px` },
    )
    observer.observe(element)
    const onScroll = () => {
      if (inside()) setShown(true)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    const poll = window.setInterval(onScroll, 300)
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      window.clearInterval(poll)
    }
  }, [ref, shown, threshold])

  return shown
}
