import { formatNumber } from './format'

/**
 * Подпись под обрезанным списком и кнопка «Показать все» (внешнее ревью 22).
 *
 * Кнопка поднимает предел до максимума, который принимает сервер. Раньше она
 * оставалась и после этого: если записей больше максимума, повторные нажатия
 * ничего не делали. Теперь кнопка есть, только пока предел не максимальный, и
 * честно говорит, сколько покажет; после — подпись «первые N из M» без кнопки.
 */
export interface ShowAllState {
  note: string
  /** Текст кнопки; null — кнопки нет. */
  action: string | null
}

export function showAllState(shown: number, total: number, limit: number, max: number): ShowAllState | null {
  if (total <= shown) return null
  const atMax = limit >= max
  return {
    note: atMax
      ? `Показаны первые ${formatNumber(shown)} из ${formatNumber(total)}.`
      : `Показаны ${formatNumber(shown)} из ${formatNumber(total)}.`,
    action: atMax ? null : total <= max ? 'Показать все' : `Показать первые ${formatNumber(max)}`,
  }
}
