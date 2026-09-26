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

/**
 * ИНН и ОГРН демо-вузов с верной контрольной суммой (решение 134, решение 141).
 *
 * Веса и формулы — те же, что в `src/shared/validation/inn-ogrn.ts` (не импортируется
 * напрямую: генератор живёт в `prisma/`, а не в `src/`, и дублирование десяти чисел
 * читается понятнее, чем путь до модуля валидации через границу пакетов). Совпадение
 * с проверкой подтверждает тест генератора: каждый выданный номер проверяется
 * `isValidLegalEntityInn`/`isValidLegalEntityOgrn`.
 *
 * Первые цифры вуза детерминированы по его ключу, поэтому номер не меняется от
 * перезаливки к перезаливке, но не претендует на существование в реальном ЕГРЮЛ.
 */
const INN10_WEIGHTS = [2, 4, 10, 3, 5, 9, 4, 6, 8] as const

/** ИНН организации: 10 цифр, 10-я — контрольная. Первая цифра не 0 — как у реальных ИНН. */
export function validInn(key: string): string {
  const rng = new Rng(`inn:${key}`)
  const digits = [rng.int(1, 9), ...Array.from({ length: 8 }, () => rng.int(0, 9))]
  const control = (INN10_WEIGHTS.reduce((sum, weight, index) => sum + weight * digits[index]!, 0) % 11) % 10
  return [...digits, control].join('')
}

/** ОГРН организации: 13 цифр, 13-я — контрольная (mod 11 mod 10 от первых 12). */
export function validOgrn(key: string): string {
  const rng = new Rng(`ogrn:${key}`)
  // Первая цифра ОГРН юрлица — признак записи (1–9, кроме 0), год регистрации — 2 цифры.
  const digits = [rng.int(1, 9), ...Array.from({ length: 11 }, () => rng.int(0, 9))]
  const body = digits.join('')
  let rest = 0
  for (const char of body) rest = (rest * 10 + Number(char)) % 11
  const control = rest % 10
  return `${body}${control}`
}
