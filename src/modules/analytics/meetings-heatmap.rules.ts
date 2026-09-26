import { MEETINGS_HEATMAP } from '@/shared/config/data-quality.config'

/**
 * Тепловая карта встреч (решение 134): 7 × 24 — день недели × час по Москве.
 * Чистые функции; выборка — meetings-heatmap.repo.ts.
 */

export const DAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const

const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

/**
 * Клетка встречи: день недели (0 — понедельник) и час в часовом поясе отображения.
 * Часовой пояс — через Intl, а не «UTC+3» вручную: так и переход на другой пояс
 * в конфиге, и исторические правила (летнее время до 2014 года) учтены сами.
 */
export function heatmapCell(date: Date, timeZone: string = MEETINGS_HEATMAP.timeZone): { day: number; hour: number } {
  const parts = formatterFor(timeZone).formatToParts(date)
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon'
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0') % 24
  return { day: WEEKDAY_INDEX[weekday] ?? 0, hour }
}

export function buildHeatmap(dates: readonly Date[], timeZone: string = MEETINGS_HEATMAP.timeZone): number[][] {
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
  for (const date of dates) {
    const { day, hour } = heatmapCell(date, timeZone)
    cells[day]![hour]! += 1
  }
  return cells
}
