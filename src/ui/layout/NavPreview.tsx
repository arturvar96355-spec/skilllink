'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { apiGet } from '../lib/api'
import { pluralize } from '../lib/format'
import styles from './Sidebar.module.css'

/**
 * Мини-сводка раздела при наведении на пункт меню (решение 79, по образцу
 * миниатюр в меню Seasats): сколько в разделе записей. Число берётся из того
 * же API списка (итог из `meta`), один раз за сессию страницы — повторное
 * наведение запросов не делает.
 */
const SOURCES: Record<string, { api: string; nouns: [string, string, string]; hint: string }> = {
  '/universities': { api: '/api/universities?withRating=false', nouns: ['вуз', 'вуза', 'вузов'], hint: 'в реестре' },
  '/programs': { api: '/api/programs', nouns: ['программа', 'программы', 'программ'], hint: 'во всех вузах' },
  // Активные — то же число, что в шапке главной (решение 86): раньше здесь были
  // все связки вместе с завершёнными, и меню говорило 8 там, где главная — 7.
  '/cooperations': {
    api: '/api/cooperations?status=DRAFT&status=ACTIVE',
    nouns: ['связка', 'связки', 'связок'],
    hint: 'активные: в работе и черновики',
  },
  '/recommendations': {
    api: '/api/recommendations',
    nouns: ['рекомендация', 'рекомендации', 'рекомендаций'],
    hint: 'с обоснованием',
  },
  '/documents': { api: '/api/documents', nouns: ['документ', 'документа', 'документов'], hint: 'по всем связкам' },
  '/products': { api: '/api/products', nouns: ['продукт', 'продукта', 'продуктов'], hint: 'IT-продукты компании' },
}

const cache = new Map<string, number | null>()

export function hasPreview(href: string): boolean {
  return href in SOURCES
}

export function NavPreview({ href, anchor }: { href: string; anchor: DOMRect }) {
  const source = SOURCES[href]
  const [total, setTotal] = useState<number | null | undefined>(cache.get(href))

  useEffect(() => {
    if (!source || cache.has(href)) return
    let alive = true
    const separator = source.api.includes('?') ? '&' : '?'
    apiGet<unknown[]>(`${source.api}${separator}pageSize=1`)
      .then((result) => {
        const value = result.meta?.total ?? null
        cache.set(href, value)
        if (alive) setTotal(value)
      })
      .catch(() => {
        cache.set(href, null)
        if (alive) setTotal(null)
      })
    return () => {
      alive = false
    }
  }, [href, source])

  if (!source) return null
  return createPortal(
    <div
      className={styles.preview}
      style={{ top: anchor.top + anchor.height / 2, left: anchor.right + 12 }}
      role="tooltip"
    >
      {total === undefined ? (
        <span className={styles.previewValue}>…</span>
      ) : total === null ? (
        <span className={styles.previewHint}>Нет данных</span>
      ) : (
        <>
          <span className={styles.previewValue}>{total.toLocaleString('ru-RU')}</span>
          <span className={styles.previewHint}>
            {pluralize(total, source.nouns)} · {source.hint}
          </span>
        </>
      )}
    </div>,
    document.body,
  )
}
