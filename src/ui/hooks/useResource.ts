'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PageMeta } from '@/shared/contracts'
import { ApiRequestError, apiGet } from '../lib/api'
import { leaveToLogin } from '../lib/session'

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

export function useResource<T>(path: string | null): Resource<T> {
  const [data, setData] = useState<T | null>(null)
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [error, setError] = useState<ApiRequestError | null>(null)
  const [isLoading, setIsLoading] = useState(path !== null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [attempt, setAttempt] = useState(0)

  // Есть ли уже показанные данные — от этого зависит, скелетон показывать или нет.
  const hasData = useRef(false)

  useEffect(() => {
    if (path === null) {
      setIsLoading(false)
      return
    }

    const controller = new AbortController()
    let cancelled = false

    if (hasData.current) setIsRefreshing(true)
    else setIsLoading(true)

    apiGet<T>(path, controller.signal)
      .then((result) => {
        if (cancelled) return
        hasData.current = true
        setData(result.data)
        setMeta(result.meta ?? null)
        setError(null)
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
        setError(apiError)
      })
      .finally(() => {
        if (cancelled) return
        setIsLoading(false)
        setIsRefreshing(false)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [path, attempt])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  return { data, meta, error, isLoading, isRefreshing, reload }
}
