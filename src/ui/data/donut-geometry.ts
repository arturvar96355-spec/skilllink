/**
 * Математика плоского кольца (решение 196): углы секторов, контуры дуг, доли.
 *
 * Отдельно от компонента, чтобы проверять без браузера: сумма долей, зазоры,
 * полный круг одним сектором, пустые и отрицательные значения.
 */

export const TAU = Math.PI * 2

/** Начало отсчёта — «12 часов»: самая крупная по смыслу доля стоит сверху. */
export const START_ANGLE = -Math.PI / 2

export interface DonutArc {
  /** Номер значения во входном списке — по нему сектор связан с подписью. */
  index: number
  /** Начало и конец сектора, радианы, по часовой стрелке от «3 часов». */
  a0: number
  a1: number
  /** Середина сектора без учёта зазора — по ней сектор выдвигается наружу. */
  mid: number
  /** Доля от суммы, 0..1. */
  share: number
}

/**
 * Сектора по значениям. Отрицательное и нулевое значение сектора не получает,
 * но номер сохраняет — подпись под кольцом остаётся на своём месте.
 * `pad` — зазор между соседними секторами, радианы; у единственного сектора
 * зазора нет — иначе в полном кольце появлялась бы щель наверху.
 */
export function donutArcs(values: readonly number[], pad = 0): DonutArc[] {
  const clean = values.map((value) => (Number.isFinite(value) && value > 0 ? value : 0))
  const total = clean.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return []

  const visible = clean.filter((value) => value > 0).length
  const gap = visible > 1 ? pad : 0
  const arcs: DonutArc[] = []
  let cursor = START_ANGLE
  clean.forEach((value, index) => {
    if (value <= 0) return
    const span = (value / total) * TAU
    // Зазор не съедает крошечный сектор целиком: остаётся хотя бы волосок.
    const inset = Math.min(gap / 2, span * 0.3)
    arcs.push({ index, a0: cursor + inset, a1: cursor + span - inset, mid: cursor + span / 2, share: value / total })
    cursor += span
  })
  return arcs
}

function point(cx: number, cy: number, r: number, angle: number): string {
  return `${round(cx + r * Math.cos(angle))} ${round(cy + r * Math.sin(angle))}`
}

/** Две цифры после запятой: рисунку хватает, разметка короче. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Контур сектора кольца: внешняя дуга туда, внутренняя обратно.
 * Полный круг одной дугой SVG не рисуется (начало совпадает с концом) —
 * тогда кольцо из двух половин с чётным правилом заливки.
 */
export function ringSectorPath(cx: number, cy: number, inner: number, outer: number, a0: number, a1: number): string {
  const span = a1 - a0
  if (span <= 0) return ''
  if (span >= TAU - 1e-6) {
    const ring = (r: number) =>
      `M${point(cx, cy, r, a0)}A${r} ${r} 0 1 1 ${point(cx, cy, r, a0 + Math.PI)}A${r} ${r} 0 1 1 ${point(cx, cy, r, a0)}Z`
    return ring(outer) + ring(inner)
  }
  const large = span > Math.PI ? 1 : 0
  return [
    `M${point(cx, cy, outer, a0)}`,
    `A${outer} ${outer} 0 ${large} 1 ${point(cx, cy, outer, a1)}`,
    `L${point(cx, cy, inner, a1)}`,
    `A${inner} ${inner} 0 ${large} 0 ${point(cx, cy, inner, a0)}`,
    'Z',
  ].join('')
}

/** Сдвиг выбранного сектора наружу по его середине. */
export function sectorOffset(mid: number, distance: number): { x: number; y: number } {
  return { x: round(Math.cos(mid) * distance), y: round(Math.sin(mid) * distance) }
}

/** Доля в процентах с одной цифрой после запятой: «24,7%». Нет суммы — null. */
export function sharePercent(value: number, total: number): string | null {
  if (!(total > 0)) return null
  return `${(Math.round((Math.max(value, 0) / total) * 1000) / 10).toLocaleString('ru-RU')}%`
}

/**
 * Следующий сектор для клавиатуры: стрелки ходят по кругу, Home/End — к краям.
 * `null` — клавиша не наша.
 */
export function nextSector(current: number, count: number, key: string): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
