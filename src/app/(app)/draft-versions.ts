import type { AiRewriteStyle } from '@/shared/contracts'

/**
 * Варианты черновика письма (решение 213): исходный текст и каждый вариант,
 * который сделали кнопки «Короче», «Мягче»… Правка руками меняет текущий вариант,
 * а не создаёт новый; «← Прошлый вариант» и «Следующий →» ходят по списку;
 * новая переделка из середины списка отбрасывает всё, что было после текущего, —
 * как «вперёд» в браузере после перехода по новой ссылке.
 */
export interface DraftVersion {
  text: string
  /** Какой кнопкой сделан; null — исходный черновик. */
  style: AiRewriteStyle | null
}

export interface DraftVersionsState {
  list: DraftVersion[]
  index: number
}

export function initialVersions(text: string): DraftVersionsState {
  return { list: [{ text, style: null }], index: 0 }
}

export function currentVersion(state: DraftVersionsState): DraftVersion {
  return state.list[state.index] ?? { text: '', style: null }
}

export function editVersion(state: DraftVersionsState, text: string): DraftVersionsState {
  return { ...state, list: state.list.map((version, index) => (index === state.index ? { ...version, text } : version)) }
}

export function addVersion(state: DraftVersionsState, text: string, style: AiRewriteStyle): DraftVersionsState {
  const list = [...state.list.slice(0, state.index + 1), { text, style }]
  return { list, index: list.length - 1 }
}

export function stepVersion(state: DraftVersionsState, delta: -1 | 1): DraftVersionsState {
  const index = Math.min(state.list.length - 1, Math.max(0, state.index + delta))
  return index === state.index ? state : { ...state, index }
}

/**
 * Черновик на сервере сменился (собран заново, сохранена правка). Если он совпал
 * с текущим вариантом — это наша же сохранённая правка, история остаётся;
 * иначе начинаем заново с нового текста.
 */
export function resetVersions(state: DraftVersionsState, text: string): DraftVersionsState {
  return currentVersion(state).text === text ? state : initialVersions(text)
}
