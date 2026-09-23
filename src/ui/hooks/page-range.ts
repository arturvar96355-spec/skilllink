'use client'

import { useEffect } from 'react'
import type { PageMeta } from '@/shared/contracts'

/** Номер последней страницы выдачи. Пустая выдача — одна пустая страница. */
export function lastPage(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

/**
 * Держит номер страницы в пределах выдачи.
 *
 * Выдача сокращается, пока человек стоит на последней странице: он сам перевёл
 * её единственную строку в другой статус или строку закрыл кто-то ещё. Раньше
 * он оставался на странице, которой больше нет, — «По выбранным условиям ничего
 * нет», а переключателя страниц в пустом списке нет, и вернуться было нечем.
 */
export function usePageInRange(
  page: number,
  setPage: (page: number) => void,
  meta: PageMeta | null,
): void {
  useEffect(() => {
    if (!meta) return
    const last = lastPage(meta.total, meta.pageSize)
    if (page > last) setPage(last)
  }, [page, setPage, meta])
}
