/**
 * Открыть глобальный поиск из любого места (решение 122): кнопка в шапке,
 * меню на узком экране. `from` — элемент, из которого окно «перетекает».
 */
export const OPEN_SEARCH_EVENT = 'skilllink:open-search'

export function openSearch(from?: HTMLElement | null): void {
  window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT, { detail: { from: from ?? null } }))
}
