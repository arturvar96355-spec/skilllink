import { formatNumber, pluralize } from '@/ui/lib/format'

/**
 * Насыщенность клетки тепловой карты встреч (решение 178, п. 7), 0..100:
 * пустая клетка — без цвета, самая занятая — почти чистый акцентный цвет.
 * Нижняя граница 15 — чтобы «одна встреча против нуля» не сливалась с фоном
 * на карте с большим максимумом. Чистая функция — вынесена из
 * `MeetingsHeatmap.tsx` отдельно от JSX, чтобы проверить тестом без рендера.
 */
export function heatIntensity(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0
  return Math.round((value / max) * 85) + 15
}

/** «в понедельник» … «в воскресенье» — для вывода одной фразой, в порядке `dayLabels` (пн … вс). */
const DAY_PHRASE = ['в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу', 'в воскресенье']

/** Встреч за каждый день недели — колонка «за день» справа от карты. */
export function dayTotals(cells: readonly (readonly number[])[]): number[] {
  return cells.map((row) => row.reduce((sum, value) => sum + value, 0))
}

/**
 * Вывод одной фразой (решение 215): самый загруженный день — «из N» всех встреч,
 * и самый загруженный час по всем дням. При равенстве — более ранний.
 */
export function heatmapConclusion(cells: readonly (readonly number[])[], total: number): string {
  if (total <= 0) return 'Проведённых встреч нет.'
  const days = dayTotals(cells)
  let day = 0
  days.forEach((value, index) => {
    if (value > days[day]!) day = index
  })
  const hours = Array.from({ length: 24 }, (_, hour) => cells.reduce((sum, row) => sum + (row[hour] ?? 0), 0))
  let hour = 0
  hours.forEach((value, index) => {
    if (value > hours[hour]!) hour = index
  })
  const share = Math.round((days[day]! / total) * 100)
  const best = hours[hour]!
  return `Чаще всего встречаются ${DAY_PHRASE[day] ?? ''}: ${formatNumber(days[day]!)} из ${formatNumber(total)} ${pluralize(total, ['встречи', 'встреч', 'встреч'])} (${share} %); самый загруженный час — ${hour}:00, ${formatNumber(best)} ${pluralize(best, ['встреча', 'встречи', 'встреч'])} за все дни.`
}
