import type { CSSProperties } from 'react'
import { Icon, formatNumber, useCountUp, type IconName } from '@/ui'
import styles from './profile.module.css'

/**
 * Плитка показателя личного кабинета: иконка и цвет по смыслу, число с досчётом.
 * `null` — «Нет данных», не ноль. Общая для «Ваша работа» и «Ваш вуз» (решение 236).
 */
export function StatTile({
  icon,
  tone,
  label,
  value,
  hint,
  order,
}: {
  icon: IconName
  tone: 'violet' | 'cyan' | 'pink' | 'danger' | 'success'
  label: string
  value: number | null
  hint: string
  order: number
}) {
  const counted = useCountUp(value, 900)
  return (
    <div className={[styles.tile, styles[tone]].join(' ')} style={{ '--i': order } as CSSProperties} title={hint}>
      <span className={styles.tileIcon}>
        <Icon name={icon} size={18} />
      </span>
      <span className={styles.tileValue}>{counted === null ? 'Нет данных' : formatNumber(Math.round(counted))}</span>
      <span className={styles.tileLabel}>{label}</span>
    </div>
  )
}
