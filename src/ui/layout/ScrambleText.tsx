'use client'

import { useEffect, useState } from 'react'
import { usePrefersReducedMotion } from '../hooks/dom'

/**
 * Текст, который проявляется из «рассыпки» (решение 79, по образцу смены слова
 * у Melius): буквы слева направо перебирают случайные знаки и встают на место.
 * ~0,7 с, один раз при появлении. Читалкам — сразу итоговый текст; «уменьшить
 * движение» — текст без эффекта.
 */
const GLYPHS = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЭЮЯ0123456789#%&*+=/<>'
const DURATION = 700

export function ScrambleText({ text }: { text: string }) {
  const reduced = usePrefersReducedMotion()
  const [shown, setShown] = useState(text)

  useEffect(() => {
    if (reduced) {
      setShown(text)
      return
    }
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / DURATION)
      const settled = Math.floor(progress * text.length)
      let next = ''
      for (let i = 0; i < text.length; i += 1) {
        const char = text[i]!
        next += i < settled || char === ' ' || char === ',' ? char : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!
      }
      setShown(next)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [text, reduced])

  return (
    <>
      <span aria-hidden>{shown}</span>
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {text}
      </span>
    </>
  )
}
