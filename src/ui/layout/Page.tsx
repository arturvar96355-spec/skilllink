'use client'

import Link from 'next/link'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Icon } from '../primitives/Icon'
import { landMorph } from '../lib/morph'
import { ScrambleText } from './ScrambleText'
import styles from './Page.module.css'

/**
 * Составные части страницы.
 *
 * Любая новая страница собирается из них (раздел 33 шаблона): своя разметка
 * заголовка означает, что отступы и размеры на ней разойдутся с остальными.
 */

export interface Crumb {
  label: string
  href?: string
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className={styles.breadcrumbs} aria-label="Навигационная цепочка">
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        return (
          <span key={`${item.label}-${index}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {index > 0 && (
              <span className={styles.crumbSeparator} aria-hidden="true">
                /
              </span>
            )}
            {item.href && !isLast ? (
              <Link href={item.href} className={styles.crumbLink}>
                {item.label}
              </Link>
            ) : (
              <span className={styles.crumbCurrent} aria-current={isLast ? 'page' : undefined}>
                {item.label}
              </span>
            )}
          </span>
        )
      })}
    </nav>
  )
}

export interface PageHeaderProps {
  title: string
  description?: string
  breadcrumbs?: Crumb[]
  /** Значки рядом с заголовком: статус, пометка демонстрационных данных. */
  meta?: ReactNode
  actions?: ReactNode
  /**
   * `display` — крупный заголовок с засечками для страниц объекта (вуз,
   * программа), как у A24 (решение 79). Реестры и служебные страницы — обычный.
   */
  variant?: 'default' | 'display'
  /**
   * Строка под заголовком — полное название, когда крупно стоит короткое
   * (страница вуза: «СПбГУТ», ниже полное). ТЗ визуалу, п. 4.
   */
  subtitle?: string
  /** Заголовок проявляется из «рассыпки» букв (решение 79) — для приветствия на главной. */
  scramble?: boolean
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  meta,
  actions,
  variant = 'default',
  subtitle,
  scramble = false,
}: PageHeaderProps) {
  // Заголовок — место посадки перехода из реестра (lib/morph): название строки,
  // по которой щёлкнули, переезжает сюда, а не исчезает вместе с реестром.
  const titleRef = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => {
    landMorph(titleRef.current)
  }, [])

  return (
    <div className={styles.section}>
      {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
      <div className={styles.pageHeader}>
        <div className={styles.titleBlock}>
          <div className={styles.titleRow}>
            <h1 ref={titleRef} className={`${styles.title} ${variant === 'display' ? styles.titleDisplay : ''}`}>
              {scramble ? <ScrambleText text={title} /> : title}
            </h1>
            {meta}
          </div>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          {description && <p className={styles.description}>{description}</p>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </div>
  )
}

export interface SectionProps {
  title?: string
  description?: string
  action?: ReactNode
  children: ReactNode
}

export function Section({ title, description, action, children }: SectionProps) {
  return (
    <section className={styles.section}>
      {(title || action) && (
        <div className={styles.sectionHead}>
          <div className={styles.sectionTitleBlock}>
            {title && <h2 className={styles.sectionTitle}>{title}</h2>}
            {description && <p className={styles.sectionDescription}>{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/**
 * Строка фильтров над списком.
 *
 * Поля выровнены по нижнему краю — так с ними встают в ряд флажки и кнопки без
 * подписи. Поэтому подсказку не ставят под отдельным полем: она удлиняла поле
 * вниз, и его подпись и рамка поднимались выше соседних. Пояснения к фильтрам —
 * одной строкой под панелью (`note`).
 */
export function Toolbar({
  children,
  actions,
  note,
}: {
  children: ReactNode
  actions?: ReactNode
  note?: ReactNode
}) {
  return (
    <div className={styles.toolbar}>
      {children}
      {actions && <div className={styles.toolbarActions}>{actions}</div>}
      {note && <p className={styles.toolbarNote}>{note}</p>}
    </div>
  )
}

export function ToolbarSearch({ children }: { children: ReactNode }) {
  return <div className={styles.toolbarSearch}>{children}</div>
}

export function ToolbarItem({ children }: { children: ReactNode }) {
  return <div className={styles.toolbarItem}>{children}</div>
}

export interface TabItem {
  key: string
  label: string
  count?: number | null
}

export function Tabs({
  items,
  active,
  onChange,
}: {
  items: TabItem[]
  active: string
  onChange: (key: string) => void
}) {
  return (
    <div className={styles.tabs} role="tablist">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={item.key === active}
          className={[styles.tab, item.key === active ? styles.tabActive : ''].filter(Boolean).join(' ')}
          onClick={() => onChange(item.key)}
        >
          {item.label}
          {item.count !== undefined && item.count !== null && (
            <span className={styles.tabCount}>{item.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

/** Обёртка содержимого страницы: короткое появление снизу вверх. */
export function PageContent({ children }: { children: ReactNode }) {
  return <div className={[styles.section, styles.enter].join(' ')}>{children}</div>
}

/** Ссылка «назад» над заголовком карточки. */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className={styles.crumbLink} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <Icon name="arrowLeft" size={16} />
      {label}
    </Link>
  )
}
