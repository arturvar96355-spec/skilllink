'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { Icon } from '../primitives/Icon'
import { IconButton } from '../primitives/IconButton'
import { formatNumber, pluralize } from '../lib/format'
import styles from './Table.module.css'

/**
 * Таблица реестров.
 *
 * Одна на все списки: вузы, программы, связки, документы. Своя таблица на каждой
 * странице означала бы четыре разных поведения строки при наведении и четыре
 * набора отступов — ровно то, чего дизайн-система требует избегать.
 */
export interface Column<T> {
  key: string
  title: string
  width?: string
  align?: 'left' | 'right'
  /** Имя поля сортировки API. Задано — заголовок кликабелен. */
  sortField?: string
  render: (row: T) => ReactNode
}

export interface DataTableProps<T> {
  rows: T[]
  columns: Column<T>[]
  getRowKey: (row: T) => string
  /** Строка ведёт на страницу объекта: щелчок по любому месту строки открывает её. */
  getRowHref?: (row: T) => string
  selectedKey?: string | null
  /** Текущая сортировка в формате API: `name` или `-updatedAt`. */
  sort?: string
  onSortChange?: (sort: string) => void
  /** Идёт повторная загрузка: данные остаются на месте, но приглушаются. */
  isRefreshing?: boolean
  caption?: string
}

export function DataTable<T>({
  rows,
  columns,
  getRowKey,
  getRowHref,
  selectedKey,
  sort,
  onSortChange,
  isRefreshing = false,
  caption,
}: DataTableProps<T>) {
  const router = useRouter()

  function toggleSort(field: string) {
    if (!onSortChange) return
    // Повторный щелчок по тому же столбцу переворачивает порядок.
    onSortChange(sort === field ? `-${field}` : field)
  }

  return (
    <div className={styles.wrapper}>
      <table className={[styles.table, isRefreshing ? styles.refreshing : ''].filter(Boolean).join(' ')}>
        {caption && <caption className="visually-hidden">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => {
              const isSorted = column.sortField
                ? sort === column.sortField || sort === `-${column.sortField}`
                : false
              return (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  className={[
                    styles.th,
                    column.align === 'right' ? styles.right : '',
                    column.sortField && onSortChange ? styles.sortable : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={column.sortField ? () => toggleSort(column.sortField!) : undefined}
                  aria-sort={
                    isSorted ? (sort?.startsWith('-') ? 'descending' : 'ascending') : undefined
                  }
                >
                  {column.title}
                  {column.sortField && onSortChange && (
                    <span
                      className={[styles.sortIcon, isSorted ? styles.sortActive : '']
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <Icon name={sort === `-${column.sortField}` ? 'chevronDown' : 'chevronRight'} size={16} />
                    </span>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = getRowKey(row)
            const href = getRowHref?.(row)
            return (
              <tr
                key={key}
                className={[
                  styles.row,
                  href ? styles.clickable : '',
                  selectedKey === key ? styles.selected : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={
                  href
                    ? (event) => {
                        // Щелчок по ссылке, кнопке или подсказке внутри строки
                        // обрабатывает сам элемент: подсказка у показателя — это
                        // span с role="button", и без неё щелчок по значку «i»
                        // открывал бы карточку вместо показа объяснения.
                        if ((event.target as HTMLElement).closest('a, button, [role="button"]')) return
                        router.push(href)
                      }
                    : undefined
                }
              >
                {columns.map((column, columnIndex) => (
                  <td
                    key={column.key}
                    className={[styles.td, column.align === 'right' ? styles.right : '']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {/*
                      Первая ячейка строки, ведущей на объект, — настоящая ссылка.
                      Без неё реестр открывался только щелчком мыши: тем, кто ходит
                      клавишей, переходов не было вовсе (раздел 33 документа
                      об интерфейсе). Ссылка ещё и открывается в новой вкладке —
                      обработчик щелчка так не умеет.
                    */}
                    {href && columnIndex === 0 ? (
                      <Link href={href} className={styles.cellLink}>
                        {column.render(row)}
                      </Link>
                    ) : (
                      column.render(row)
                    )}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  /** Что считаем: «12 вузов», «40 связок». */
  nouns?: [string, string, string]
}

export function Pagination({ page, pageSize, total, onPageChange, nouns }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total === 0) return null

  return (
    <div className={styles.pagination}>
      <span className={styles.total}>
        {nouns ? `${formatNumber(total)} ${pluralize(total, nouns)}` : `Всего: ${formatNumber(total)}`}
      </span>
      {pages > 1 && (
        <div className={styles.pages}>
          <IconButton
            icon="chevronLeft"
            label="Предыдущая страница"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          />
          <span className={styles.pageInfo}>
            {page} из {pages}
          </span>
          <IconButton
            icon="chevronRight"
            label="Следующая страница"
            size="sm"
            disabled={page >= pages}
            onClick={() => onPageChange(page + 1)}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Текст ячейки в одну строку.
 *
 * Длинное значение обрезается многоточием, полное — в подсказке при наведении.
 * Так строка реестра всегда одной высоты: перенос названия вуза на вторую
 * строку удваивал её, и на экран влезало вдвое меньше записей.
 */
export function CellText({
  children,
  title,
  muted = false,
  strong = false,
}: {
  children: ReactNode
  /** Полный текст для подсказки. По умолчанию — сам текст, если это строка. */
  title?: string
  muted?: boolean
  strong?: boolean
}) {
  const fullText = title ?? (typeof children === 'string' ? children : undefined)
  return (
    <span
      className={[styles.truncate, muted ? styles.cellMuted : '', strong ? styles.cellStrong : '']
        .filter(Boolean)
        .join(' ')}
      title={fullText}
    >
      {children}
    </span>
  )
}
