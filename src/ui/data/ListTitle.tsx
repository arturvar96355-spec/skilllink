import type { ReactNode } from 'react'
import styles from './ListTitle.module.css'

/**
 * Заголовок записи в ленте (DataTable appearance="list"): название крупно,
 * под ним одна строка пояснения — то, что раньше было отдельными столбцами.
 * Название помечено `data-morph-title`: оно перелетает в заголовок карточки
 * и светлеет при наведении.
 */
export function ListTitle({
  title,
  subline,
  leading,
  badge,
  tooltip,
}: {
  title: ReactNode
  /** Части пояснения; пустые пропускаются, между остальными — точка. */
  subline?: Array<ReactNode | null | undefined | false>
  /** Слева от названия: аватар-аббревиатура. */
  leading?: ReactNode
  /** Справа от названия: пометка «демо». */
  badge?: ReactNode
  /** Полный текст для подсказки. */
  tooltip?: string
}) {
  const parts = (subline ?? []).filter((part) => part !== null && part !== undefined && part !== false && part !== '')
  return (
    <span className={styles.root} title={tooltip}>
      {leading && <span className={styles.leading}>{leading}</span>}
      <span className={styles.text}>
        <span className={styles.titleRow}>
          <span className={styles.title} data-morph-title>
            {title}
          </span>
          {badge}
        </span>
        {parts.length > 0 && (
          <span className={styles.subline}>
            {parts.map((part, index) => (
              <span key={index} className={styles.part}>
                {part}
              </span>
            ))}
          </span>
        )}
      </span>
    </span>
  )
}
