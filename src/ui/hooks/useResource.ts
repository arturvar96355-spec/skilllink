'use client'

import { useCallback, useEffect, useState } from 'react'
import type { PageMeta } from '@/shared/contracts'
import { ApiRequestError, apiGet } from '../lib/api'
import { leaveToLogin } from '../lib/session'
import { presentResource, type LoadedResource } from './resource-state'

/**
 * Загрузка данных одного экрана.
 *
 * Возвращает ровно те четыре состояния, которые обязана показывать каждая
 * страница (docs/DESIGN_INTEGRATION.md): загрузка, ошибка, пусто, успех.
 * Пустоту определяет сам экран — по содержимому `data`.
 */
export interface Resource<T> {
  data: T | null
  meta: PageMeta | null
  error: ApiRequestError | null
  isLoading: boolean
  /** Данные уже были, идёт повторная загрузка: список не подменяется скелетоном. */
  isRefreshing: boolean
  reload: () => void
}

export interface ResourceOptions {
  /**
   * Пока грузится новый адрес, показывать данные прежнего.
   *
   * Для списков, где адрес меняют фильтр, страница или «показать ещё»: строки
   * остаются на месте и не подменяются скелетоном. Для карточки по id, поиска
   * и зависимых списков — нельзя: там прежние данные принадлежат другой записи
   * или другому запросу (resource-state.ts).
   */
  keepPreviousData?: boolean
}

export function useResource<T>(path: string | null, options: ResourceOptions = {}): Resource<T> {
  const [loaded, setLoaded] = useState<LoadedResource<T, ApiRequestError> | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (path === null) return

    const controller = new AbortController()
    let cancelled = false
    setIsPending(true)

    apiGet<T>(path, controller.signal)
      .then((result) => {
        if (cancelled) return
        setLoaded({ path, data: result.data, meta: result.meta ?? null, error: null })
      })
      .catch((caught: unknown) => {
        if (cancelled || controller.signal.aborted) return
        const apiError =
          caught instanceof ApiRequestError
            ? caught
            : new ApiRequestError('Непредвиденная ошибка', 'INTERNAL', 0)

        // Сессия кончилась или больше ни на кого не указывает: возвращаем
        // на вход, сняв старую, — а не показываем пустой экран.
        if (apiError.code === 'UNAUTHORIZED') {
          void leaveToLogin()
          return
        }
        // Повторная загрузка того же адреса не стирает уже показанное.
        setLoaded((previous) =>
          previous?.path === path
            ? { ...previous, error: apiError }
            : { path, data: null, meta: null, error: apiError },
        )
      })
      .finally(() => {
        if (cancelled) return
        setIsPending(false)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [path, attempt])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  return {
    ...presentResource(loaded, path, isPending, options.keepPreviousData ?? false),
    reload,
  }
}
