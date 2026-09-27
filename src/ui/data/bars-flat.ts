/**
 * Чистая логика столбиков «Связки по вузам» (`BarsFlat`, решение 201): куда
 * поставить подсказку и какой вуз следующий при нажатии стрелки. Без DOM —
 * проверяется тестом `bars-flat.test.ts`.
 */

export type TipSide = 'right' | 'left' | 'above' | 'below' | 'clamped'

/**
 * Место подсказки рядом с выбранной парой столбиков, в пикселях блока.
 *
 * Порядок как у Bklit: справа от пары; не помещается до края — слева; не
 * помещается и слева (телефон, пара посередине) — над парой, если выше её
 * верха есть место; нет и там — под полом, на подписях оси (`field.bottom` —
 * низ блока с легендой): подписи на миг закрыты, но пара видна целиком, а её
 * имя — в заголовке подсказки. Последний запасной путь — сторона, где места
 * больше, с прижатием к краю: лучше перекрыть краешек пары, чем уйти за край блока.
 */
export function placeBarTip(
  pair: { left: number; right: number; top: number },
  tip: { width: number; height: number },
  field: { width: number; floor: number; bottom?: number },
  gap = 12,
): { left: number; top: number; side: TipSide } {
  const clampTop = (value: number) => Math.max(0, Math.min(value, field.floor - tip.height))
  // Сбоку — на уровне верха пары, чуть выше: взгляд идёт от маркера к подсказке.
  const sideTop = clampTop(pair.top - 10)

  const right = pair.right + gap
  if (right + tip.width <= field.width) return { left: right, top: sideTop, side: 'right' }

  const left = pair.left - gap - tip.width
  if (left >= 0) return { left, top: sideTop, side: 'left' }

  const center = (pair.left + pair.right) / 2
  const clampLeft = (value: number) => Math.max(0, Math.min(value, field.width - tip.width))
  const above = pair.top - gap - tip.height
  if (above >= 0) return { left: clampLeft(center - tip.width / 2), top: above, side: 'above' }

  const below = field.floor + gap
  if (field.bottom !== undefined && below + tip.height <= field.bottom) {
    return { left: clampLeft(center - tip.width / 2), top: below, side: 'below' }
  }

  const roomRight = field.width - pair.right
  const roomLeft = pair.left
  return {
    left: clampLeft(roomRight >= roomLeft ? right : left),
    top: sideTop,
    side: 'clamped',
  }
}

/** Следующий вуз по клавише: стрелки — на один, Home/End — к краю; иначе `null`. */
export function stepIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return Math.min(count - 1, current + 1)
    case 'ArrowLeft':
    case 'ArrowUp':
      return Math.max(0, current - 1)
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
