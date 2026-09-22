import styles from './Progress.module.css'

export interface ProgressProps {
  /** 0..100. null — «Нет данных»: полоса остаётся пустой, значение не подменяется нулём. */
  value: number | null
  tone?: 'default' | 'danger' | 'success'
  /** Показать число справа от полосы. */
  withValue?: boolean
  label?: string
}

export function Progress({ value, tone = 'default', withValue = false, label }: ProgressProps) {
  const percent = value === null ? 0 : Math.max(0, Math.min(100, value))
  const bar = (
    <div
      className={styles.track}
      role="progressbar"
      aria-valuenow={value ?? undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      aria-valuetext={value === null ? 'Нет данных' : `${Math.round(percent)}%`}
    >
      <div
        className={[styles.fill, tone !== 'default' ? styles[tone] : ''].filter(Boolean).join(' ')}
        style={{ width: `${percent}%` }}
      />
    </div>
  )

  if (!withValue) return bar

  return (
    <div className={styles.row}>
      {bar}
      <span className={styles.value}>{value === null ? '—' : `${Math.round(percent)}%`}</span>
    </div>
  )
}
