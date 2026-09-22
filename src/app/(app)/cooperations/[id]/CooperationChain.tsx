'use client'

import Link from 'next/link'
import { Icon } from '@/ui'
import { productHref, programHref, universityHref } from '@/ui'
import styles from './CooperationChain.module.css'

/**
 * Схема связки.
 *
 * Единица учёта системы — тройка «вуз — образовательная программа —
 * IT-продукт». Раньше на карточке она выглядела тремя подписями в ряд,
 * и из экрана нельзя было понять, что это одна цепочка, а не список.
 *
 * Продукт может отсутствовать: на первых этапах его ещё не выбрали
 * (решение 1 проекта). Пустое место показывается пунктиром — это не ошибка,
 * а нормальное состояние связки, и прятать его нельзя.
 */
export interface CooperationChainProps {
  universityId: string
  universityName: string
  programId: string
  programName: string
  productId: string | null
  productName: string | null
}

export function CooperationChain({
  universityId,
  universityName,
  programId,
  programName,
  productId,
  productName,
}: CooperationChainProps) {
  return (
    <div className={styles.chain}>
      <Link href={universityHref(universityId)} className={[styles.node, styles.link].join(' ')}>
        <span className={styles.icon}>
          <Icon name="university" size={18} />
        </span>
        <span className={styles.text}>
          <span className={styles.role}>Университет</span>
          <span className={styles.name}>{universityName}</span>
        </span>
      </Link>

      <span className={styles.link2} aria-hidden="true">
        <Icon name="arrowRight" size={18} />
      </span>

      <Link href={programHref(programId)} className={[styles.node, styles.link].join(' ')}>
        <span className={styles.icon}>
          <Icon name="program" size={18} />
        </span>
        <span className={styles.text}>
          <span className={styles.role}>Образовательная программа</span>
          <span className={styles.name}>{programName}</span>
        </span>
      </Link>

      <span className={styles.link2} aria-hidden="true">
        <Icon name="arrowRight" size={18} />
      </span>

      {productId && productName ? (
        <Link href={productHref(productId)} className={[styles.node, styles.link].join(' ')}>
          <span className={styles.icon}>
            <Icon name="product" size={18} />
          </span>
          <span className={styles.text}>
            <span className={styles.role}>IT-продукт</span>
            <span className={styles.name}>{productName}</span>
          </span>
        </Link>
      ) : (
        <span className={[styles.node, styles.empty].join(' ')}>
          <span className={[styles.icon, styles.emptyIcon].join(' ')}>
            <Icon name="product" size={18} />
          </span>
          <span className={styles.text}>
            <span className={styles.role}>IT-продукт</span>
            <span className={styles.nameEmpty}>Не выбран</span>
            <span className={styles.note}>До этапа оформления это допустимо</span>
          </span>
        </span>
      )}
    </div>
  )
}
