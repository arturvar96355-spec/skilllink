import styles from './Skeleton.module.css'

export interface SkeletonProps {
  width?: string
  height?: string
  radius?: string
}

export function Skeleton({ width = '100%', height = '14px', radius }: SkeletonProps) {
  return (
    <span
      className={styles.skeleton}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
      // Заготовка вот-вот сменится данными: переход между страницами
      // (layout/navigation-motion) по этой метке ждёт их и не берёт её в веер.
      data-skeleton
    />
  )
}

/** Несколько строк подряд — для списков и карточек. */
export function SkeletonLines({ count = 3, height = '14px' }: { count?: number; height?: string }) {
  return (
    <span className={styles.stack} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} height={height} width={index === count - 1 ? '60%' : '100%'} />
      ))}
    </span>
  )
}
