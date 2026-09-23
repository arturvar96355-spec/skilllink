'use client'

import { useState } from 'react'
import { Select, type SelectOption, type SelectProps } from '../primitives/Select'
import { useResource } from '../hooks/useResource'
import { useDebounced } from '../hooks/dom'
import { buildQuery } from '../lib/api'
import { formatNumber } from '../lib/format'

/** Сколько вариантов приходит за раз. Остальные находятся поиском. */
export const REMOTE_SELECT_LIMIT = 50

/**
 * До скольких вариантов поиск не показывается: такой список читается глазами
 * целиком, и поле ввода в нём — лишнее. В демо-наборе шесть вузов.
 */
export const REMOTE_SELECT_SEARCH_FROM = 12

export interface RemoteSelectProps<Row>
  extends Omit<SelectProps, 'options' | 'search' | 'valueLabel'> {
  /** Список API без параметров: `/api/universities`. Карточка — `${endpoint}/${id}`. */
  endpoint: string
  /** Постоянные параметры запроса: сортировка, фильтр по вузу. */
  params?: Record<string, string | number | undefined>
  toOption: (row: Row) => SelectOption
  searchPlaceholder?: string
  /** Текст на кнопке, когда вариантов нет вовсе: «У вуза нет программ». */
  emptyPlaceholder?: string
}

/**
 * Выпадающий список, который берёт варианты из API с поиском на сервере.
 *
 * Раньше списки вузов, программ и связок загружались целиком с `pageSize=100`,
 * и всё, что дальше сотни, молча пропадало: на базе с тысячей вузов связку
 * с вузом на «Т» нельзя было создать, а фильтр по нему — выбрать. Теперь
 * приходят первые пятьдесят, остальное находится поиском, и список честно
 * пишет, что показан не целиком.
 */
export function RemoteSelect<Row>({
  endpoint,
  params,
  toOption,
  searchPlaceholder = 'Найти по названию',
  emptyPlaceholder,
  value,
  onValueChange,
  placeholder,
  disabled = false,
  ...selectProps
}: RemoteSelectProps<Row>) {
  const [query, setQuery] = useState('')
  const appliedQuery = useDebounced(query.trim())
  const [chosen, setChosen] = useState<SelectOption | null>(null)

  // Выключенному списку варианты не нужны: программы до выбора вуза
  // были бы программами всех вузов подряд.
  const list = useResource<Row[]>(
    disabled
      ? null
      : `${endpoint}${buildQuery({ ...params, q: appliedQuery || undefined, pageSize: REMOTE_SELECT_LIMIT })}`,
  )
  const options = (list.data ?? []).map(toOption)
  const total = list.meta?.total ?? null

  // Выбранное значение может не попасть в текущую выборку: выбрано поиском
  // или пришло извне (фильтр страницы). Подпись тогда берётся из карточки.
  const inOptions = options.find((option) => option.value === value)
  const knownLabel = inOptions?.label ?? (chosen?.value === value ? chosen.label : undefined)
  const lookup = useResource<Row>(
    value !== '' && knownLabel === undefined ? `${endpoint}/${encodeURIComponent(value)}` : null,
  )
  const valueLabel = knownLabel ?? (lookup.data ? toOption(lookup.data).label : undefined)

  // Поле поиска не исчезает, пока человек печатает, даже если выборка сузилась.
  const needsSearch = query !== '' || (total !== null && total > REMOTE_SELECT_SEARCH_FROM)

  let note: string | null = null
  if (!list.isLoading && !list.isRefreshing) {
    if (options.length === 0 && appliedQuery !== '') note = 'Ничего не найдено'
    else if (total !== null && total > options.length) {
      note = `Показаны ${formatNumber(options.length)} из ${formatNumber(total)} — уточните поиск`
    }
  }

  const isEmpty = !disabled && list.data !== null && total === 0 && appliedQuery === ''

  return (
    <Select
      {...selectProps}
      value={value}
      disabled={disabled || isEmpty}
      placeholder={
        list.error ? 'Список недоступен' : isEmpty && emptyPlaceholder ? emptyPlaceholder : placeholder
      }
      options={options}
      valueLabel={valueLabel}
      onValueChange={(next) => {
        setChosen(options.find((option) => option.value === next) ?? null)
        setQuery('')
        onValueChange(next)
      }}
      search={
        needsSearch
          ? { query, onQueryChange: setQuery, placeholder: searchPlaceholder, note }
          : undefined
      }
    />
  )
}
