'use client'

import type { ReactNode } from 'react'
import { InfoHint, Skeleton } from '@/ui'
import styles from './settings.module.css'

/**
 * Строки страницы настроек — общие для всех разделов, в том числе вкладок
 * администратора «Пользователи» и «Журнал действий», которые живут в своих
 * файлах: страница Next не может экспортировать ничего, кроме себя самой.
 */

/** Тот же «?», что на остальных страницах (решение 212). */
export const Hint = InfoHint

/** Строка: слева название и короткая подпись, справа значение или действие. */
export function Row({
  title,
  caption,
  hint,
  children,
}: {
  title: ReactNode
  caption?: ReactNode
  hint?: string
  children?: ReactNode
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <span className={styles.rowTitle}>
          {title}
          {hint && <Hint text={hint} />}
        </span>
        {caption && <span className={styles.rowCaption}>{caption}</span>}
      </div>
      {children !== undefined && <div className={styles.rowSide}>{children}</div>}
    </div>
  )
}

/** Строки-заглушки на время загрузки: высота раздела не прыгает. */
export function RowsSkeleton({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={styles.row}>
          <div className={styles.rowText}>
            <Skeleton width="180px" />
            <Skeleton width="260px" height="12px" />
          </div>
        </div>
      ))}
    </>
  )
}
