'use client'

import Link from 'next/link'
import { useId, type HTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import type { QueueTone, QueueValueTone } from './queue-row'
import styles from './QueueRow.module.css'

/**
 * Очередь — плотный список строк с группами (решение 206).
 *
 * Одна система строк на два соседних блока главной — «Требует внимания» и
 * «Приоритетные действия»: полоска серьёзности слева, заголовок в одну строку,
 * мета мельче, справа значение и одно действие. Не карточки: карточка — для
 * того, что выбирают и сравнивают, а здесь очередь дел (07, раздел 40).
 *
 * Узкий блок (телефон, ≤ 480 px ширины самой очереди): заголовок — до двух
 * строк, мета переносится, значение встаёт над действием, действие сжимается
 * до значка 40 × 40 — подпись остаётся для чтения с экрана.
 */
export function Queue({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={[styles.queue, className ?? ''].filter(Boolean).join(' ')}>{children}</div>
}

/** Группа очереди: маленький заголовок с числом и строки под ним. */
export function QueueGroup({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  const id = useId()
  return (
    <section className={styles.group} aria-labelledby={id}>
      <h3 className={styles.groupHead} id={id}>
        <span>{label}</span>
        <span className={styles.groupCount}>{count}</span>
      </h3>
      <ul className={styles.rows}>{children}</ul>
    </section>
  )
}

/** Подвал очереди: что не показано и куда за ним идти. */
export function QueueFoot({ children }: { children: ReactNode }) {
  return <div className={styles.foot}>{children}</div>
}

/** Ссылка в подвале очереди — акцентным текстом, без рамки кнопки. */
export function QueueFootLink({ href, children, 'aria-label': ariaLabel }: { href: string; children: ReactNode; 'aria-label'?: string }) {
  return (
    <Link className={styles.footLink} href={href} aria-label={ariaLabel}>
      {children}
    </Link>
  )
}

/** Вторая строка: запись этапа «06 / 14», текст (обрезается многоточием) и хвост («· Савельева О. Д.»). */
export interface QueueRowMeta {
  notation?: string
  text?: string
  tail?: string
  /** Хвост на узком блоке — например, инициалы «СО» вместо «Савельева О. Д.»: название этапа важнее. */
  tailShort?: string
  /** Подсказка к хвосту — полное ФИО, когда в строке сокращённое. */
  tailTitle?: string
}

interface QueueRowBase {
  tone: QueueTone
  title: string
  meta?: QueueRowMeta
  value?: { text: string; tone: QueueValueTone }
  /** Одно действие справа — `Button` размера `sm`; на узком блоке становится значком. */
  action?: ReactNode
  /** Имя основной части строки для чтения с экрана: всё, что видно в строке, одной фразой. */
  label: string
  /** Дополнительные свойства элемента списка — например, всплывающая карточка связки. */
  itemProps?: HTMLAttributes<HTMLLIElement>
}

/** Строка-ссылка: вся строка ведёт на объект, кнопка действия лежит поверх. */
interface QueueRowLinkProps extends QueueRowBase {
  href: string
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>) => void
  expanded?: never
  onToggle?: never
  detail?: never
}

/** Строка-раскрытие: щелчок раскрывает подробности под строкой. */
interface QueueRowToggleProps extends QueueRowBase {
  expanded: boolean
  onToggle: () => void
  detail: ReactNode
  href?: never
  onNavigate?: never
}

export type QueueRowProps = QueueRowLinkProps | QueueRowToggleProps

export function QueueRow(props: QueueRowProps) {
  const { tone, title, meta, value, action, label, itemProps } = props
  const detailId = useId()
  const isToggle = props.onToggle !== undefined
  const expanded = isToggle && props.expanded

  const body = (
    <>
      <span className={styles.title} data-morph-title>
        {title}
      </span>
      {meta && (meta.notation || meta.text || meta.tail) && (
        <span className={styles.meta}>
          {meta.notation && <span className={styles.notation}>{meta.notation}</span>}
          {meta.text && <span className={styles.metaText}>{meta.text}</span>}
          {meta.tail && (
            <span className={styles.metaTail} title={meta.tailTitle} data-short={meta.tailShort ? true : undefined}>
              <span className={styles.tailFull}>{meta.tail}</span>
              {meta.tailShort && (
                <span className={styles.tailShort} aria-hidden>
                  {meta.tailShort}
                </span>
              )}
            </span>
          )}
        </span>
      )}
    </>
  )

  return (
    <li {...itemProps} className={styles.row} data-tone={tone} data-expanded={expanded || undefined}>
      <span className={styles.ind} aria-hidden />
      <div className={styles.head} data-has-value={value ? true : undefined}>
        {isToggle ? (
          <button
            type="button"
            className={styles.main}
            aria-expanded={expanded}
            aria-controls={expanded ? detailId : undefined}
            aria-label={label}
            onClick={props.onToggle}
          >
            {body}
          </button>
        ) : (
          <Link className={styles.main} href={props.href} aria-label={label} onClick={props.onNavigate}>
            {body}
          </Link>
        )}
        {value && (
          <span className={styles.value} data-tone={value.tone}>
            {value.text}
          </span>
        )}
        {action && <span className={styles.act}>{action}</span>}
      </div>
      {expanded && (
        <div className={styles.detail} id={detailId}>
          {props.detail}
        </div>
      )}
    </li>
  )
}
