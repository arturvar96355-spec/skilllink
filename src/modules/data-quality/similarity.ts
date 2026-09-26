/**
 * Меры сходства строк (решение 134). Чистые функции, без базы.
 *
 * Триграммы считаются так же, как в расширении pg_trgm PostgreSQL: строка режется
 * на слова по всему, что не буква и не цифра; слово приводится к нижнему регистру
 * и дополняется двумя пробелами слева и одним справа; триграммы — все подстроки
 * длины 3, без повторов. Сходство — коэффициент Жаккара |A ∩ B| / |A ∪ B|.
 * Поэтому число из приложения совпадает с `similarity()` базы и его можно проверить
 * запросом.
 */

/** Слова строки так, как их видит pg_trgm: только буквы и цифры. */
export function trigramWords(value: string): string[] {
  return value
    .toLocaleLowerCase('ru')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0)
}

/** Множество триграмм строки. «кот» → {"  к", " ко", "кот", "от "}. */
export function trigrams(value: string): Set<string> {
  const result = new Set<string>()
  for (const word of trigramWords(value)) {
    const chars = [...`  ${word} `]
    for (let index = 0; index + 3 <= chars.length; index += 1) {
      result.add(chars.slice(index, index + 3).join(''))
    }
  }
  return result
}

/** Сходство по триграммам, 0..1. Две пустые строки несравнимы — 0, а не 1. */
export function trigramSimilarity(left: string, right: string): number {
  return jaccard(trigrams(left), trigrams(right))
}

export function jaccard<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): number {
  if (left.size === 0 || right.size === 0) return 0
  let common = 0
  for (const item of left) if (right.has(item)) common += 1
  return common / (left.size + right.size - common)
}

/**
 * Расстояние Левенштейна — минимум вставок, удалений и замен знака.
 * Считается по кодовым точкам, а не по UTF-16: иначе эмодзи или редкий знак
 * засчитывались бы за две правки.
 */
export function levenshtein(left: string, right: string): number {
  const a = [...left]
  const b = [...right]
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
      current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution))
    }
    previous = current
  }
  return previous[b.length]!
}

/**
 * Левенштейн с перестановкой соседних знаков за одну правку (вариант Дамерау,
 * «оптимальное выравнивание строк»). Самая частая опечатка — «Pyhton» вместо
 * «Python»: по чистому Левенштейну это две правки, по этому — одна.
 */
export function editDistance(left: string, right: string): number {
  const a = [...left]
  const b = [...right]
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let best = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, rows[i - 2]![j - 2]! + 1)
      }
      rows[i]![j] = best
    }
  }
  return rows[a.length]![b.length]!
}

/** Сходство по числу правок, 0..1: 1 − правки / длина большей строки. */
export function editSimilarity(left: string, right: string): number {
  const longest = Math.max([...left].length, [...right].length)
  if (longest === 0) return 0
  return 1 - editDistance(left, right) / longest
}
