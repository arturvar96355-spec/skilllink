'use client'

import { useEffect, useState } from 'react'
import { UI_MODE_ATTRIBUTE } from '../lib/ui-mode'
import styles from './Splash.module.css'

/** Отметка в sessionStorage: заставку в этой вкладке уже показали. */
const SEEN_KEY = 'skilllink_splash_seen'
/** Сколько заставка живёт с момента, когда появилась на экране, — вся сцена успевает сыграть. */
const MIN_VISIBLE_MS = 2000
/** Раскрытие перед уходом. */
const EXIT_MS = 650

const WORD = 'SkillLink'
const STAGES = 14

/**
 * Скрипт до первой отрисовки: заставку уже видели в этой вкладке, просили
 * «уменьшить движение» или выбран рабочий режим интерфейса (решение 80) —
 * она не показывается вовсе, даже на кадр. Работает до загрузки JavaScript
 * приложения, поэтому встроенный. Идёт после `UI_MODE_BOOT_SCRIPT`: режим
 * к этому моменту уже стоит атрибутом на `<html>`.
 */
export const SPLASH_BOOT_SCRIPT = `window.__splashStart=performance.now();try{if(document.documentElement.getAttribute('${UI_MODE_ATTRIBUTE}')!=='showcase'||sessionStorage.getItem('${SEEN_KEY}')||matchMedia('(prefers-reduced-motion: reduce)').matches){document.documentElement.setAttribute('data-splash','skip')}}catch(e){}`

/**
 * Заставка при входе на сайт.
 *
 * Разметка отдаётся сервером и играет на CSS — видна сразу, до загрузки
 * JavaScript, то есть именно тогда, когда страница ещё грузится. Сцена —
 * фирменная: знак SkillLink прорисовывается (связь между двумя точками),
 * буквы поднимаются по одной, под ними маршрут из 14 этапов зажигается
 * засечками. Потом заставка раскрывается кругом из центра.
 *
 * Один раз за вкладку; при «уменьшить движение» и в рабочем режиме не показывается.
 */
export function Splash() {
  const [phase, setPhase] = useState<'show' | 'exit' | 'gone'>('show')

  useEffect(() => {
    if (document.documentElement.getAttribute('data-splash') === 'skip') {
      setPhase('gone')
      return
    }
    try {
      sessionStorage.setItem(SEEN_KEY, '1')
    } catch {
      // Хранилище недоступно (приватный режим) — заставка покажется и в следующий раз.
    }
    // Отсчёт — от появления сцены (скрипт стоит прямо перед ней), а не от начала
    // запроса: иначе при медленном сервере сцена обрывалась бы на середине.
    const start = (window as unknown as { __splashStart?: number }).__splashStart ?? 0
    const wait = Math.max(0, MIN_VISIBLE_MS - (performance.now() - start))
    const exitTimer = window.setTimeout(() => setPhase('exit'), wait)
    const goneTimer = window.setTimeout(() => setPhase('gone'), wait + EXIT_MS)
    return () => {
      window.clearTimeout(exitTimer)
      window.clearTimeout(goneTimer)
    }
  }, [])

  if (phase === 'gone') return null

  return (
    <div
      className={[styles.splash, phase === 'exit' ? styles.exit : ''].filter(Boolean).join(' ')}
      aria-hidden="true"
      data-splash-screen
    >
      <div className={styles.glow} />
      <div className={styles.scene}>
        <svg className={styles.mark} width="72" height="72" viewBox="0 0 32 32" fill="none">
          <path className={styles.markLine} d="M9 22 23 10" pathLength={1} />
          <circle className={styles.markDotA} cx="9" cy="22" r="4.5" />
          <circle className={styles.markDotB} cx="23" cy="10" r="4.5" />
        </svg>

        <div className={styles.word}>
          {WORD.split('').map((letter, index) => (
            <span key={index} className={styles.letter} style={{ animationDelay: `${520 + index * 45}ms` }}>
              {letter}
            </span>
          ))}
        </div>
        <div className={styles.caption}>Вузы × IT-компании</div>

        <div className={styles.rail}>
          <span className={styles.railLine} />
          {Array.from({ length: STAGES }, (_, index) => (
            <span
              key={index}
              className={styles.tick}
              style={{ left: `${(index / (STAGES - 1)) * 100}%`, animationDelay: `${900 + index * 55}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
