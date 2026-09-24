'use client'

import { useEffect } from 'react'

/** Насколько кнопка тянется за курсором: доля расстояния и потолок в пикселях. */
const PULL = 0.18
const MAX_SHIFT_PX = 4
/** На каком расстоянии от кнопки притяжение начинается. */
const REACH_PX = 36

/**
 * «Магнитные» главные кнопки (навык ui-ux-pro-max, Hover Micro-interaction / Complex):
 * кнопка с `data-magnetic` чуть смещается к курсору, когда он рядом, и мягко
 * возвращается. Двигается свойство `translate` — у `transform` кнопки своё
 * движение при наведении и нажатии, одно другого не сбивает. Смещение не больше
 * 4 px: кнопка не уходит из-под курсора. Один обработчик на весь документ;
 * при «уменьшить движение» и на сенсорных экранах выключено.
 */
export function useMagneticButtons(): void {
  useEffect(() => {
    if (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !window.matchMedia('(pointer: fine)').matches
    ) {
      return
    }

    let active: HTMLElement | null = null
    let frame = 0

    const release = () => {
      if (active) active.style.translate = ''
      active = null
    }

    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        // Притягивает курсор, подошедший близко, а не только наведённый: ищем
        // ближайшую главную кнопку в пределах REACH_PX. Их на экране единицы.
        let candidate: HTMLElement | null = null
        let dx = 0
        let dy = 0
        for (const element of document.querySelectorAll<HTMLElement>('[data-magnetic]')) {
          const rect = element.getBoundingClientRect()
          const x = event.clientX - (rect.left + rect.width / 2)
          const y = event.clientY - (rect.top + rect.height / 2)
          if (Math.abs(x) < rect.width / 2 + REACH_PX && Math.abs(y) < rect.height / 2 + REACH_PX) {
            candidate = element
            dx = x
            dy = y
            break
          }
        }
        if (!candidate) {
          release()
          return
        }
        if (active && active !== candidate) release()
        active = candidate
        const clamp = (value: number) => Math.max(-MAX_SHIFT_PX, Math.min(MAX_SHIFT_PX, value * PULL))
        candidate.style.translate = `${clamp(dx).toFixed(1)}px ${clamp(dy).toFixed(1)}px`
      })
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('blur', release)
      cancelAnimationFrame(frame)
      release()
    }
  }, [])
}
