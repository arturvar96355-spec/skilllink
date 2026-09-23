'use client'

import Link from 'next/link'
import type { CSSProperties } from 'react'
import { productHref, programHref, universityHref } from '@/ui'
import styles from './CooperationChain.module.css'

/**
 * Схема связки — Collaboration Link Map (07, раздел 7).
 *
 * Единица учёта системы — тройка «вуз — программа — IT-продукт», а смысл
 * тройки — работа ИТ-Школы с этим вузом. Поэтому цепочка начинается с неё
 * самой: другой компании в системе нет, и выдумывать её нельзя. От цепочки
 * отходит ветка к текущему этапу — где связка на маршруте из четырнадцати.
 *
 * Узлы — типографикой, без иконок в квадратах. Линии — связи, а не украшение:
 * при появлении дорисовываются по очереди, по цепочке проходит один импульс.
 * Наведение на узел подсвечивает его соседей и приглушает остальное.
 *
 * Продукт может отсутствовать: на первых этапах его ещё не выбрали (решение 1).
 * Тогда последнее звено — пунктир: это нормальное состояние, прятать его нельзя.
 */
export interface CooperationChainProps {
  universityId: string
  universityName: string
  /** Краткое название вуза — «СПбГУТ»: полное в узле схемы обрезалось. */
  universityShortName?: string | null
  programId: string
  programName: string
  productId: string | null
  productName: string | null
  /** Текущий этап — ветка «06 / 14 · Подписание документов». */
  stage?: { number: number; title: string; isProblem: boolean; total: number } | null
}

export function CooperationChain({
  universityId,
  universityName,
  universityShortName,
  programId,
  programName,
  productId,
  productName,
  stage,
}: CooperationChainProps) {
  const hasProduct = productId !== null && productName !== null

  return (
    <div className={styles.map}>
      <div className={styles.chain}>
        <span className={styles.node} data-node="company" style={{ '--n': 0 } as CSSProperties}>
          <span className={styles.role}>Компания</span>
          <span className={styles.name}>ИТ-Школа РТК</span>
        </span>

        <span className={styles.link} data-link="company-university" style={{ '--n': 0 } as CSSProperties} aria-hidden />

        <Link
          href={universityHref(universityId)}
          className={styles.node}
          data-node="university"
          style={{ '--n': 1 } as CSSProperties}
        >
          <span className={styles.role}>Вуз</span>
          <span className={styles.name} title={universityName}>
            {universityShortName ?? universityName}
          </span>
        </Link>

        <span className={styles.link} data-link="university-program" style={{ '--n': 1 } as CSSProperties} aria-hidden />

        <Link
          href={programHref(programId)}
          className={styles.node}
          data-node="program"
          style={{ '--n': 2 } as CSSProperties}
        >
          <span className={styles.role}>Программа</span>
          <span className={styles.name}>{programName}</span>
        </Link>

        <span
          className={[styles.link, hasProduct ? '' : styles.linkMissing].filter(Boolean).join(' ')}
          data-link="program-product"
          style={{ '--n': 2 } as CSSProperties}
          aria-hidden
        />

        {hasProduct ? (
          <Link
            href={productHref(productId)}
            className={styles.node}
            data-node="product"
            style={{ '--n': 3 } as CSSProperties}
          >
            <span className={styles.role}>IT-продукт</span>
            <span className={styles.name}>{productName}</span>
          </Link>
        ) : (
          <span className={[styles.node, styles.missing].join(' ')} data-node="product" style={{ '--n': 3 } as CSSProperties}>
            <span className={styles.role}>IT-продукт</span>
            <span className={styles.name}>Не выбран</span>
            <span className={styles.note}>До этапа оформления это допустимо</span>
          </span>
        )}
      </div>

      {stage && (
        <div className={styles.branch}>
          <span className={styles.branchLine} aria-hidden />
          <span className={[styles.stage, stage.isProblem ? styles.stageProblem : ''].filter(Boolean).join(' ')}>
            <span className={styles.notation}>
              {String(stage.number).padStart(2, '0')} / {stage.total}
            </span>
            {stage.title}
          </span>
        </div>
      )}
    </div>
  )
}
