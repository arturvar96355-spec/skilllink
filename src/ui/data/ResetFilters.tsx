'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { Button } from '../primitives/Button'

/**
 * «Сбросить фильтры» (решение 109) — одна кнопка на всех списках: в панели
 * фильтров, пока задан поиск или хоть один фильтр, и в пустом состоянии, если
 * список пуст из-за фильтров. `onReset` обнуляет состояние страницы; параметры
 * фильтров в адресе (`urlKeys`, например ?productId=) убирает `useResetUrl`.
 */
export function ResetFilters({ active, onReset }: { active: boolean; onReset: () => void }) {
  if (!active) return null
  return (
    <Button variant="ghost" size="sm" icon="close" onClick={onReset}>
      Сбросить фильтры
    </Button>
  )
}

/** Убрать из адреса параметры фильтров, не трогая остальное (открытую запись). */
export function useResetUrl(): (keys: string[]) => void {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  return useCallback(
    (keys: string[]) => {
      if (!keys.some((key) => params.has(key))) return
      const next = new URLSearchParams(params.toString())
      for (const key of keys) next.delete(key)
      const rest = next.toString()
      router.replace(rest === '' ? pathname : `${pathname}?${rest}`, { scroll: false })
    },
    [router, pathname, params],
  )
}
