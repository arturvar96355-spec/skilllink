/**
 * Доля 0..1 в пунктах из 100 — целым: «77 из 100». Одно правило для текстов
 * сервера и интерфейса, чтобы обоснование и рекомендация по одному навыку
 * называли одно и то же число и без дробной точки в русском тексте.
 */
export function outOf100(share: number): number {
  return Math.round(share * 100)
}

/** Округление до указанного числа знаков. */
export function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * Приведение к 0..1 по минимуму и максимуму выборки.
 * Если все значения равны, возвращается 1 для непустого значения — иначе показатель
 * пришлось бы обнулить, а это исказило бы рейтинг.
 */
export function normalize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  if (max === min) return value > 0 ? 1 : 0
  return Math.min(1, Math.max(0, (value - min) / (max - min)))
}

/** Минимум и максимум по непустым значениям. null, если непустых нет. */
export function range(values: Array<number | null | undefined>): { min: number; max: number } | null {
  const filled = values.filter((value): value is number => typeof value === 'number')
  if (filled.length === 0) return null
  return { min: Math.min(...filled), max: Math.max(...filled) }
}

export function percent(part: number, total: number, digits = 1): number | null {
  if (total <= 0) return null
  return round((part / total) * 100, digits)
}
