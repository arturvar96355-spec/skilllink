'use client'

import { useEffect, useState } from 'react'
import styles from './docs.module.css'

/**
 * «#» у заголовка раздела: копирует постоянную ссылку `/docs#<раздел>` (решение 214).
 *
 * Ссылка — всегда на публичную `/docs`, даже внутри системы: её отправляют тому,
 * у кого может не быть входа. Итог нажатия — словами рядом со значком и для
 * программ чтения с экрана («Ссылка скопирована»), без всплывающего окна.
 */
export function DocsAnchor({ id, title }: { id: string; title: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (state === 'idle') return
    const timer = window.setTimeout(() => setState('idle'), 2400)
    return () => window.clearTimeout(timer)
  }, [state])

  async function copy() {
    const url = `${window.location.origin}/docs#${id}`
    try {
      await navigator.clipboard.writeText(url)
      setState('copied')
    } catch {
      setState('failed')
    }
    // Адрес в строке браузера тоже ведёт к разделу — без прыжка страницы.
    window.history.replaceState(null, '', `#${id}`)
  }

  return (
    <span className={styles.anchorWrap} data-doc-skip>
      <button
        type="button"
        className={styles.anchor}
        aria-label={`Скопировать ссылку на раздел «${title}»`}
        title="Скопировать ссылку на раздел"
        onClick={() => void copy()}
      >
        #
      </button>
      <span className={styles.anchorStatus} role="status" aria-live="polite">
        {state === 'copied' ? 'Ссылка скопирована' : state === 'failed' ? 'Не скопировалось — адрес в строке браузера' : ''}
      </span>
    </span>
  )
}
