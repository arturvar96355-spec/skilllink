'use client'

import { useEffect } from 'react'
import { Button, Icon, Logo, reportClientError } from '@/ui'
import './globals.css'
import styles from './global-error.module.css'

/**
 * Сбой уровня всего приложения (решение 183): упал сам корневой каркас
 * (`layout.tsx`), а не одна страница — тогда Next вызывает этот файл вместо
 * него, и он должен сам нести `<html>`/`<body>`. Заставки, темы и шрифта здесь
 * нет — только токены `globals.css`, тем же приёмом, что у `not-found.tsx`.
 *
 * Отчёт (без персональных данных — `reportClientError`) уходит один раз на
 * ошибку: эффект перезапускается только при новой `error` (сравнение по ссылке,
 * `reset()` создаёт новый рендер с прежней, повторной отправки не будет).
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError(error, 'global-error')
  }, [error])

  return (
    <html lang="ru">
      <body className={styles.body}>
        <main className={styles.screen}>
          <div className={styles.panel}>
            <span className={styles.brand}>
              <Logo size={24} />
              SkillLink
            </span>
            <span className={styles.icon}>
              <Icon name="alert" size={24} />
            </span>
            <h1 className={styles.title}>Что-то сломалось</h1>
            <p className={styles.text}>
              Страница не открылась из-за ошибки в приложении. Попробуйте ещё раз — если не поможет,
              вернитесь на главную и откройте раздел заново.
            </p>
            {error.digest && <p className={styles.digest}>Код ошибки: {error.digest}</p>}
            <div className={styles.actions}>
              <Button onClick={reset} icon="refresh">
                Попробовать снова
              </Button>
              <Button href="/" variant="secondary" icon="home">
                На главную
              </Button>
            </div>
          </div>
        </main>
      </body>
    </html>
  )
}
