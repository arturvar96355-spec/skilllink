'use client'

import { useId, type MouseEvent } from 'react'
import { useTheme } from '../hooks/theme'
import styles from './ThemeToggle.module.css'

/**
 * Переключатель темы (решение 103): одна кнопка, солнце плавно превращается
 * в луну и обратно — лучи втягиваются, круг «съедается» тенью. Новая тема
 * растекается кругом от кнопки (View Transitions), а не мигает весь экран.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'
  // У каждой кнопки своя маска: переключателей на странице бывает два (шапка и настройки).
  const mask = `theme-moon-${useId().replace(/:/g, '')}`

  function onClick(event: MouseEvent<HTMLButtonElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    setTheme(next, { x: box.left + box.width / 2, y: box.top + box.height / 2 })
  }

  return (
    <button
      type="button"
      className={styles.toggle}
      data-theme-icon={theme}
      onClick={onClick}
      aria-label={next === 'light' ? 'Включить светлую тему' : 'Включить тёмную тему'}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <mask id={mask}>
          <rect x="0" y="0" width="24" height="24" fill="white" />
          <circle className={styles.bite} cx="24" cy="4" r="8" fill="black" />
        </mask>
        <circle className={styles.core} cx="12" cy="12" r="5" mask={`url(#${mask})`} />
        <g className={styles.rays}>
          {Array.from({ length: 8 }, (_, index) => (
            <line
              key={index}
              x1="12"
              y1="2.6"
              x2="12"
              y2="4.6"
              transform={`rotate(${index * 45} 12 12)`}
            />
          ))}
        </g>
      </svg>
    </button>
  )
}
