import type { PageMeta } from '@/shared/contracts'

/** Последний ответ сервера — вместе с адресом, на который он пришёл. */
export interface LoadedResource<T, E> {
  path: string
  data: T | null
  meta: PageMeta | null
  error: E | null
}

export interface PresentedResource<T, E> {
  data: T | null
  meta: PageMeta | null
  error: E | null
  isLoading: boolean
  isRefreshing: boolean
}

/**
 * Что показать экрану: данные — только того адреса, который запрошен сейчас.
 *
 * Раньше загрузка хранила последний ответ без адреса и отдавала его, какой бы
 * адрес ни запросили потом. Отсюда:
 * - панель рекомендации не закрывалась: адрес пропадал (`null`), а данные
 *   прежней рекомендации оставались, и панель считала её открытой;
 * - в форме связки после смены вуза можно было выбрать программу прежнего вуза,
 *   пока не пришёл новый список, — сервер отвергал пару;
 * - поиск при повторном открытии показывал результаты прошлого запроса.
 *
 * Прежние данные на время загрузки нового адреса показываются, только если экран
 * попросил об этом сам (`keepPreviousData`) — списки с фильтрами и страницами.
 * Возврат к уже загруженному адресу (вкладку закрыли и открыли) показывает его
 * данные сразу: это данные именно этого адреса.
 */
export function presentResource<T, E>(
  loaded: LoadedResource<T, E> | null,
  path: string | null,
  isPending: boolean,
  keepPreviousData: boolean,
): PresentedResource<T, E> {
  if (path === null) {
    return { data: null, meta: null, error: null, isLoading: false, isRefreshing: false }
  }

  const isCurrent = loaded?.path === path
  const shown = isCurrent || keepPreviousData ? loaded : null
  const data = shown?.data ?? null
  // Ждём ответа на этот адрес: запрос в пути или ещё не отправлен.
  const isAwaiting = isPending || !isCurrent

  return {
    data,
    meta: shown?.meta ?? null,
    error: isCurrent && !isPending ? (loaded?.error ?? null) : null,
    isLoading: isAwaiting && data === null,
    isRefreshing: isAwaiting && data !== null,
  }
}
