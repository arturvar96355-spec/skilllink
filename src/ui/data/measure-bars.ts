/**
 * Доля полосы на общей шкале (решение 215): значение / правый край, 0..1.
 * null — «Нет данных»: полосы нет вовсе, а не полоса нулевой длины.
 * Пустая шкала (все нули) не делит на ноль — полосы нулевой длины.
 */
export function measureShare(value: number | null | undefined, max: number): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  if (!(max > 0)) return 0
  return Math.max(0, Math.min(value / max, 1))
}
