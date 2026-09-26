/**
 * Открыть глобальный поиск из любого места (решение 122): кнопка в шапке,
 * меню на узком экране. `from` — элемент, из которого окно «перетекает».
 *
 * Повторный щелчок по той же кнопке закрывает окно, а не открывает его снова
 * (решение 184, было так же до общей кнопки поиска в шапке — решение 103) —
 * слушатель в `GlobalSearch` сам решает по `nextSearchAction`, открыт ли поиск
 * уже сейчас.
 */
export const OPEN_SEARCH_EVENT = 'skilllink:open-search'

export function openSearch(from?: HTMLElement | null): void {
  window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT, { detail: { from: from ?? null } }))
}

/** Что делать по щелчку кнопки поиска: открыть, если закрыт, иначе закрыть. */
export function nextSearchAction(isOpen: boolean): 'open' | 'close' {
  return isOpen ? 'close' : 'open'
}
