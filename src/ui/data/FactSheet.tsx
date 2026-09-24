import type { ReactNode } from 'react'
import styles from './FactSheet.module.css'

/**
 * Лист фактов (решение 79, по образцу A24): надзаголовок, крупное название
 * и строки «подпись — значение» на тонких линиях. Им подписаны центральные
 * бирки реестров и шапки страниц вуза и программы.
 */
export interface Fact {
  label: string
  value: ReactNode
}

export function FactSheet({
  kicker,
  title,
  facts,
  size = 'md',
  footer,
}: {
  kicker?: ReactNode
  title: ReactNode
  facts: Fact[]
  /** `lg` — шапка страницы, `md` — блок рядом с каруселью. */
  size?: 'md' | 'lg'
  footer?: ReactNode
}) {
  return (
    <div className={`${styles.root} ${size === 'lg' ? styles.lg : ''}`}>
      {kicker && <span className={styles.kicker}>{kicker}</span>}
      <span className={styles.title}>{title}</span>
      <dl className={styles.facts}>
        {facts.map((fact) => (
          <div key={fact.label} className={styles.row}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
      {footer && <div className={styles.footer}>{footer}</div>}
    </div>
  )
}
