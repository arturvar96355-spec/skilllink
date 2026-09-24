import Link from 'next/link'
import type { ReactNode } from 'react'
import { Icon } from '../primitives/Icon'
import styles from './NextObject.module.css'

/**
 * «Следующий объект» внизу страницы (решение 79, по образцу A24 — «следующий
 * фильм»): огромное название на тонких линиях и половинка знака, выглядывающая
 * снизу. По реестру можно идти подряд, не возвращаясь к списку.
 */
export function NextObject({
  kicker,
  title,
  href,
  visual,
}: {
  kicker: string
  title: string
  href: string
  /** Знак объекта — логотип или сокращение; видна верхняя половина. */
  visual: ReactNode
}) {
  return (
    <Link href={href} className={styles.root}>
      <span className={styles.kicker}>
        {kicker}
        <Icon name="arrowRight" size={16} />
      </span>
      <span className={styles.title}>{title}</span>
      <span className={styles.visual} aria-hidden>
        {visual}
      </span>
    </Link>
  )
}
