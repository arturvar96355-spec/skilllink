import type { ReactNode } from 'react'
import styles from './Badge.module.css'

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent' | 'info' | 'mock'

export interface BadgeProps {
  tone?: BadgeTone
  /** Точка перед текстом — для статусов, где полезен быстрый цветовой признак. */
  withDot?: boolean
  title?: string
  children: ReactNode
}

export function Badge({ tone = 'neutral', withDot = false, title, children }: BadgeProps) {
  return (
    // `data-badge` — для спокойного вида внутри таблиц (data/Table): там значок
    // статуса — цветная точка и приглушённая подпись, без плашки.
    <span className={[styles.badge, styles[tone]].join(' ')} title={title} data-badge data-tone={tone}>
      {withDot && <span className={styles.dot} aria-hidden="true" />}
      <span data-badge-label>{children}</span>
    </span>
  )
}

/**
 * Пометка демонстрационных данных.
 *
 * Требование раздела 4 ТЗ и решения проекта: показывать обязательно, выдавать
 * демо-набор за подтверждённую статистику нельзя.
 */
export function MockBadge({ title }: { title?: string }) {
  return (
    <Badge
      tone="mock"
      title={title ?? 'Часть данных демонстрационная. За подтверждённую статистику не выдаётся.'}
    >
      Демонстрационные данные
    </Badge>
  )
}
