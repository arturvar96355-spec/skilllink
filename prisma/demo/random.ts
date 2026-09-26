/**
 * Детерминированный генератор случайных чисел для демо-набора (решение 131).
 *
 * Math.random не используется: каждая заливка должна давать один и тот же набор,
 * иначе числа сценария показа и слайдов расходились бы от перезаливки к перезаливке.
 * Зерно у каждого объекта своё — хеш его ключа: вставка новой связки в список
 * не сдвигает случайные величины соседей.
 */

/** FNV-1a, 32 бита: хеш строки для зерна. */
export function fnv1a(text: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** mulberry32: 32-битный ГПСЧ, числа в [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class Rng {
  private readonly next: () => number

  constructor(key: string) {
    this.next = mulberry32(fnv1a(key))
  }

  /** Число в [0, 1). */
  random(): number {
    return this.next()
  }

  /** Число в [min, max). */
  uniform(min: number, max: number): number {
    return min + (max - min) * this.next()
  }

  /** Целое в [min, max] включительно. */
  int(min: number, max: number): number {
    return Math.floor(this.uniform(min, max + 1))
  }

  chance(probability: number): boolean {
    return this.next() < probability
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: пустой список')
    return items[Math.floor(this.next() * items.length)] as T
  }

  /** Стандартное нормальное (Бокс — Мюллер). */
  normal(): number {
    const u = 1 - this.next()
    const v = this.next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  /**
   * Логнормальная величина с заданной медианой: длительности этапов.
   * Хвост вправо — как в жизни: этап обычно идёт около медианы, иногда — втрое дольше.
   */
  lognormal(median: number, sigma: number): number {
    return median * Math.exp(sigma * this.normal())
  }
}

/**
 * Идентификатор записи, похожий на cuid (25 знаков, начинается с «c»), но
 * детерминированный: тот же объект демо-набора получает тот же id при каждой
 * заливке — ссылка на карточку у эксперта переживает перезаливку стенда.
 * 64+ бита из трёх хешей: на десятках тысяч записей совпадений не бывает.
 */
export function demoId(kind: string, key: string): string {
  const text = `${kind}:${key}`
  const part = (seed: number) => fnv1a(text, seed).toString(36).padStart(7, '0').slice(-7)
  return `cd${part(0x811c9dc5)}${part(0x1b873593)}${part(0xcc9e2d51)}`.padEnd(25, '0').slice(0, 25)
}
