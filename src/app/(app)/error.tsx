'use client'

import { useEffect } from 'react'
import { Button, Icon, reportClientError } from '@/ui'
import styles from './error.module.css'

/**
 * Сбой одной внутренней страницы (решение 183): каркас (`layout.tsx`, боковое
 * меню и шапка) остаётся на месте — падает только содержимое ниже него, и
 * граница ошибки его и заменяет. Для сбоя всего приложения — `global-error.tsx`.
 *
 * Отчёт (без персональных данных — `reportClientError`) уходит один раз на
 * ошибку: эффект перезапускается только при новой `error`.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError(error, 'app-error')
  }, [error])

  return (
    <div className={styles.block}>
      <span className={styles.icon}>
        <Icon name="alert" size={24} />
      </span>
      <p className={styles.title}>Что-то сломалось</p>
      <p className={styles.text}>
        Страница не открылась из-за ошибки. Попробуйте ещё раз — если не поможет, вернитесь на главную.
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
  )
}
