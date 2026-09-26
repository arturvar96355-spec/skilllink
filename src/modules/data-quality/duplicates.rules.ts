import { DUPLICATES } from '@/shared/config/data-quality.config'
import type { DuplicateEntityType, DuplicateMethod } from '@/shared/contracts/data-quality'
import { compactKey, coreWords, normalizeSkillName, normalizeText, normalizeUniversityName } from './normalize'
import { editDistance, trigramSimilarity } from './similarity'

/**
 * Поиск дублей (решение 134): оценка пары записей и перебор пар. Чистые функции —
 * база отдаёт записи (и, на больших справочниках, кандидатов по pg_trgm), всё
 * остальное считается здесь и проверяется тестами.
 */

export interface UniversityCandidate {
  id: string
  name: string
  shortName: string | null
  city: string
  inn: string | null
}

export interface SkillCandidate {
  id: string
  name: string
  category: string
}

export interface ProgramCandidate {
  id: string
  name: string
  code: string | null
  level: string
  universityId: string
  universityName: string
}

export interface ProductCandidate {
  id: string
  name: string
  category: string
}

export interface PairScore {
  score: number
  method: DuplicateMethod
  reasons: string[]
}

const round3 = (value: number) => Math.round(value * 1000) / 1000
const percent = (value: number) => `${Math.round(value * 100)}%`

/**
 * Сходство двух нормализованных названий: совпадение, триграммы, а у коротких
 * строк ещё и число правок. Берётся лучшее — и способ, которым оно получено.
 */
export function textScore(left: string, right: string): PairScore {
  if (left === right) return { score: 1, method: 'normalized', reasons: ['Названия совпадают после нормализации'] }

  const trigram = trigramSimilarity(left, right)
  let best: PairScore = {
    score: trigram,
    method: 'trigram',
    reasons: [`Сходство по триграммам ${percent(trigram)}`],
  }

  const { minLength, maxLength, maxEditsShort, maxEditsLong, shortUpTo } = DUPLICATES.levenshtein
  const longest = Math.max([...left].length, [...right].length)
  const shortest = Math.min([...left].length, [...right].length)
  if (shortest >= minLength && longest <= maxLength) {
    const edits = editDistance(left, right)
    const allowed = longest <= shortUpTo ? maxEditsShort : maxEditsLong
    const byEdits = 1 - edits / longest
    if (edits <= allowed && byEdits > best.score) {
      best = {
        score: byEdits,
        method: 'levenshtein',
        reasons: [`Отличие в ${edits} ${edits === 1 ? 'знаке' : 'знаках'} — похоже на опечатку`],
      }
    }
  }
  return best
}

/**
 * Совпадение слов с допуском на опечатку: доля общих слов (Жаккар по словам),
 * где слово длиной от 5 знаков считается тем же при одной правке, от 8 — при двух.
 */
export function fuzzyWordJaccard(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return 0
  const unmatched = [...right]
  let matched = 0
  for (const word of left) {
    const index = unmatched.findIndex((other) => {
      if (other === word) return true
      const length = Math.min(word.length, other.length)
      if (length < 5) return false
      return editDistance(word, other) <= (length >= 8 ? 2 : 1)
    })
    if (index !== -1) {
      matched += 1
      unmatched.splice(index, 1)
    }
  }
  return matched / (left.length + right.length - matched)
}

// ─────────────────────────────────── Вузы ───────────────────────────────────

/**
 * Пара вузов.
 *
 * 1. ИНН есть у обоих: совпал — дубль наверняка (1.0), разный — разные юрлица, не дубль.
 * 2. Полные названия совпали после нормализации и словаря — 1.0.
 * 3. Сокращённое название одного — аббревиатура или сокращение другого — 0.9.
 * 4. Иначе — значимая часть названия (без «государственный», «университет», города
 *    и «имени …»): триграммы × доля общих слов. Произведение, а не среднее: у МГУ
 *    и МПГУ триграммы близки, но «педагогический» есть только у одного.
 * Множители: разные города × 0.8, разное «имени …» × 0.5.
 */
export function scoreUniversities(a: UniversityCandidate, b: UniversityCandidate): PairScore | null {
  if (a.inn && b.inn) {
    if (a.inn !== b.inn) return null
    return { score: 1, method: 'inn', reasons: ['Совпадает ИНН — это одно юридическое лицо'] }
  }

  const cities = [a.city, b.city]
  const sameCity = normalizeText(a.city) === normalizeText(b.city)
  const left = normalizeUniversityName(a.name)
  const right = normalizeUniversityName(b.name)
  const leftCore = coreWords(left, cities)
  const rightCore = coreWords(right, cities)
  const reasons: string[] = []

  let best: PairScore
  if (left.full === right.full) {
    const expanded = normalizeText(a.name) !== left.full || normalizeText(b.name) !== right.full
    best = expanded
      ? { score: DUPLICATES.synonymScore, method: 'abbreviation', reasons: ['Совпадают после раскрытия сокращений'] }
      : { score: 1, method: 'normalized', reasons: ['Названия совпадают после нормализации'] }
  } else {
    const trigram = trigramSimilarity(leftCore.join(' '), rightCore.join(' '))
    const words = fuzzyWordJaccard(leftCore, rightCore)
    best = {
      score: trigram * words,
      method: 'trigram',
      reasons: [
        `Значимая часть названия: «${leftCore.join(' ')}» и «${rightCore.join(' ')}» — триграммы ${percent(trigram)}, общие слова ${percent(words)}`,
      ],
    }
    const aliasesOf = (item: UniversityCandidate, name: typeof left) =>
      new Set([item.shortName ? compactKey(item.shortName) : null, name.acronym].filter((key): key is string => !!key))
    const aliasesA = aliasesOf(a, left)
    const aliasesB = aliasesOf(b, right)
    const shared = [...aliasesA].find((key) => aliasesB.has(key))
    // Аббревиатура — только в одном городе: НГТУ есть и в Новосибирске, и в Нижнем Новгороде.
    if (shared && sameCity && DUPLICATES.abbreviationScore > best.score) {
      best = {
        score: DUPLICATES.abbreviationScore,
        method: 'abbreviation',
        reasons: [`Совпадает сокращённое название «${shared.toLocaleUpperCase('ru')}»`],
      }
    }
  }
  reasons.push(...best.reasons)

  let score = best.score
  if (left.honorific && right.honorific) {
    const honorific = trigramSimilarity(left.honorific, right.honorific)
    if (honorific < DUPLICATES.differentHonorificBelow) {
      score *= DUPLICATES.differentHonorificFactor
      reasons.push(`Разное «имени …»: «${left.honorific}» и «${right.honorific}»`)
    } else {
      reasons.push('Совпадает «имени …»')
    }
  }
  if (sameCity) {
    reasons.push(`Один город: ${a.city}`)
  } else {
    score *= DUPLICATES.differentCityFactor
    reasons.push(`Разные города: ${a.city} и ${b.city}`)
  }
  return { score: round3(score), method: best.method, reasons }
}

// ─────────────────────────────────── Навыки ──────────────────────────────────

/** Пара навыков: словарь синонимов (js — javascript, k8s — kubernetes), потом сходство названий. */
export function scoreSkills(a: SkillCandidate, b: SkillCandidate): PairScore {
  const left = normalizeSkillName(a.name)
  const right = normalizeSkillName(b.name)
  let result: PairScore
  if (left.canonical === right.canonical && (left.bySynonym || right.bySynonym)) {
    result = {
      score: DUPLICATES.synonymScore,
      method: 'synonym',
      reasons: [`Синонимы по словарю: «${a.name}» и «${b.name}» — это ${left.canonical}`],
    }
  } else if (compactKey(a.name) === compactKey(b.name)) {
    result = { score: 1, method: 'normalized', reasons: ['Совпадают без пробелов, точек и дефисов'] }
  } else {
    result = textScore(left.canonical, right.canonical)
  }
  const reasons = [...result.reasons]
  reasons.push(a.category === b.category ? `Одна категория: ${a.category}` : `Разные категории: ${a.category} и ${b.category}`)
  return { score: round3(result.score), method: result.method, reasons }
}

// ────────────────────────────────── Программы ─────────────────────────────────

/**
 * Пара программ. Сравниваются только программы одного вуза: «Программная
 * инженерия» в двух вузах — не дубль, а норма. Разный уровень — × 0.8.
 */
export function scorePrograms(a: ProgramCandidate, b: ProgramCandidate): PairScore | null {
  if (a.universityId !== b.universityId) return null
  const result = textScore(normalizeText(a.name), normalizeText(b.name))
  const reasons = [...result.reasons, `Один вуз: ${a.universityName}`]
  let score = result.score
  if (a.level === b.level) {
    reasons.push('Один уровень образования')
  } else {
    score *= DUPLICATES.differentLevelFactor
    reasons.push('Разный уровень образования')
  }
  if (a.code && b.code) {
    reasons.push(a.code === b.code ? `Совпадает код ${a.code}` : `Разные коды: ${a.code} и ${b.code}`)
  }
  return { score: round3(score), method: result.method, reasons }
}

// ────────────────────────────────── Продукты ─────────────────────────────────

export function scoreProducts(a: ProductCandidate, b: ProductCandidate): PairScore {
  const result = textScore(normalizeText(a.name), normalizeText(b.name))
  const reasons = [...result.reasons]
  reasons.push(a.category === b.category ? `Одна категория: ${a.category}` : `Разные категории: ${a.category} и ${b.category}`)
  return { score: round3(result.score), method: result.method, reasons }
}

// ─────────────────────────────────── Перебор ─────────────────────────────────

export interface FoundPair<T> {
  a: T
  b: T
  score: number
  method: DuplicateMethod
  reasons: string[]
}

/** Ключ пары без учёта порядка: меньший id первым. Так пара хранится и в исключениях. */
export function pairKey(first: string, second: string): [string, string] {
  return first < second ? [first, second] : [second, first]
}

export interface FindPairsOptions {
  threshold: number
  /**
   * Пары-кандидаты (id, id). Не заданы — сравниваются все со всеми; заданы — только
   * они (кандидаты отобрала база по pg_trgm плюс блокировка по ключам ниже).
   */
  candidates?: ReadonlyArray<readonly [string, string]>
}

/**
 * Все пары со сходством не ниже порога, самые похожие первыми. Внутри пары
 * записи упорядочены по id — так её можно отметить «не дубль».
 */
export function findPairs<T extends { id: string }>(
  items: readonly T[],
  score: (a: T, b: T) => PairScore | null,
  options: FindPairsOptions,
): Array<FoundPair<T>> {
  const byId = new Map(items.map((item) => [item.id, item]))
  const pairs: Array<readonly [T, T]> = []
  if (options.candidates) {
    const seen = new Set<string>()
    for (const [first, second] of options.candidates) {
      if (first === second) continue
      const [x, y] = pairKey(first, second)
      const key = `${x}|${y}`
      const left = byId.get(x)
      const right = byId.get(y)
      if (seen.has(key) || !left || !right) continue
      seen.add(key)
      pairs.push([left, right])
    }
  } else {
    const sorted = [...items].sort((left, right) => (left.id < right.id ? -1 : 1))
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) pairs.push([sorted[i]!, sorted[j]!])
    }
  }

  const found: Array<FoundPair<T>> = []
  for (const [a, b] of pairs) {
    const result = score(a, b)
    if (!result || result.score < options.threshold) continue
    found.push({ a, b, ...result })
  }
  return found.sort((left, right) => right.score - left.score || (left.a.id + left.b.id < right.a.id + right.b.id ? -1 : 1))
}

/**
 * Блокировка по ключам для большого справочника: пары записей с одинаковым
 * каноническим ключом (синоним навыка, аббревиатура вуза, ИНН). Триграммы базы
 * такие пары не найдут — «JS» и «JavaScript» по триграммам не похожи.
 */
export function blockingPairs<T extends { id: string }>(
  items: readonly T[],
  keysOf: (item: T) => readonly string[],
): Array<[string, string]> {
  const groups = new Map<string, string[]>()
  for (const item of items) {
    for (const key of new Set(keysOf(item))) {
      const group = groups.get(key) ?? []
      group.push(item.id)
      groups.set(key, group)
    }
  }
  const pairs: Array<[string, string]> = []
  for (const ids of groups.values()) {
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) pairs.push(pairKey(ids[i]!, ids[j]!))
    }
  }
  return pairs
}

/** Ключи блокировки по сущности. */
export const BLOCKING_KEYS = {
  university: (item: UniversityCandidate) => {
    const name = normalizeUniversityName(item.name)
    return [
      `full:${name.full}`,
      `alias:${name.acronym}`,
      ...(item.shortName ? [`alias:${compactKey(item.shortName)}`] : []),
      ...(item.inn ? [`inn:${item.inn}`] : []),
    ]
  },
  skill: (item: SkillCandidate) => [`canon:${normalizeSkillName(item.name).canonical}`, `compact:${compactKey(item.name)}`],
  program: (item: ProgramCandidate) => [`name:${item.universityId}:${normalizeText(item.name)}`],
  product: (item: ProductCandidate) => [`name:${normalizeText(item.name)}`],
} satisfies Record<DuplicateEntityType, (item: never) => string[]>
