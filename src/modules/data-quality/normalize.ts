import {
  SKILL_SYNONYMS,
  SKILL_WORD_SYNONYMS,
  UNIVERSITY_ACRONYMS,
  UNIVERSITY_GENERIC_WORDS,
  UNIVERSITY_LEGAL_FORMS,
  UNIVERSITY_WORD_ABBREVIATIONS,
} from './dictionaries'
import { levenshtein } from './similarity'

/**
 * Нормализация названий перед сравнением (решение 134).
 *
 * Общая часть: NFKC, нижний регистр, «ё» → «е», без кавычек всех видов, точки,
 * запятые, скобки и косые черты — пробел, пробелы свёрнуты. Дефис внутри слова
 * остаётся («ун-т», «санкт-петербургский»): по нему узнаются сокращения.
 * `+` и `#` остаются — иначе C++ и C# стали бы просто «c».
 */
export function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ru')
    .replaceAll('ё', 'е')
    .replace(/["'«»“”„‚‘’`]/g, '')
    .replace(/[.,;:!?()[\]{}/\\|]/g, ' ')
    .replace(/\s+-\s+|\s+-|-\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function mapWords(value: string, dictionary: Readonly<Record<string, string>>): string {
  return value
    .split(' ')
    .map((word) => dictionary[word] ?? word)
    .join(' ')
}

function stripLegalForms(value: string): string {
  let result = ` ${value} `
  for (const form of UNIVERSITY_LEGAL_FORMS) result = result.replaceAll(` ${form} `, ' ')
  return result.replace(/\s+/g, ' ').trim()
}

export interface NormalizedUniversityName {
  /** Полное нормализованное название: сокращения раскрыты, форма собственности снята. */
  full: string
  /** Слова значимой части: без типовых слов и «имени …». Город снимает сравнение (coreWords). */
  core: string[]
  /** «Имени …» — отдельно: у тёзок в одном городе оно и различает. */
  honorific: string | null
  /** Аббревиатура из первых букв полного названия: «мтуси», «спбгут». */
  acronym: string
}

/**
 * Слово похоже на типовое («госудраственный» с опечаткой — тоже типовое): для
 * длинных слов допускается две правки, иначе опечатка сделала бы его значимым.
 */
function isGenericWord(word: string): boolean {
  if (UNIVERSITY_GENERIC_WORDS.has(word)) return true
  if (word.length < 8) return false
  for (const generic of UNIVERSITY_GENERIC_WORDS) {
    if (generic.length >= 8 && levenshtein(word, generic) <= 2) return true
  }
  return false
}

/**
 * Аббревиатура из первых букв слов: «Санкт-Петербургский государственный университет
 * телекоммуникаций» → «спбгут». «Санкт-Петербургский» даёт «спб», как принято;
 * союз «и» и всё начиная с «имени» пропускаются.
 */
export function universityAcronym(full: string): string {
  const words = full.split(' ')
  const cut = words.indexOf('имени')
  return (cut === -1 ? words : words.slice(0, cut))
    .filter((word) => word !== 'и')
    .map((word) => (word === 'санкт-петербургский' ? 'спб' : word.split('-').map((part) => part[0] ?? '').join('')))
    .join('')
}

/**
 * Нормализация названия вуза — одна на название, а сравнений у него столько, сколько
 * вузов: результат запоминается (кэш ограничен, чтобы не расти без конца).
 */
const universityNameCache = new Map<string, NormalizedUniversityName>()
const CACHE_LIMIT = 20_000

/** Название вуза для сравнения. */
export function normalizeUniversityName(name: string): NormalizedUniversityName {
  const cached = universityNameCache.get(name)
  if (cached) return cached

  const text = stripLegalForms(normalizeText(name))
  const expanded = text
    .split(' ')
    .map((word) => UNIVERSITY_ACRONYMS[word] ?? UNIVERSITY_WORD_ABBREVIATIONS[word] ?? word)
    .join(' ')
  const full = stripLegalForms(expanded)

  const words = full.split(' ')
  const honorificAt = words.indexOf('имени')
  const honorific = honorificAt === -1 ? null : words.slice(honorificAt + 1).join(' ') || null
  const main = honorificAt === -1 ? words : words.slice(0, honorificAt)
  const core = main.filter((word) => !isGenericWord(word))

  const result = { full, core: core.length > 0 ? core : main, honorific, acronym: universityAcronym(full) }
  if (universityNameCache.size >= CACHE_LIMIT) universityNameCache.clear()
  universityNameCache.set(name, result)
  return result
}

/**
 * Значимая часть без городов сравниваемых записей: «Уральский федеральный университет
 * (Екатеринбург)» и «Уральский федеральный университет» — одно и то же.
 */
export function coreWords(name: NormalizedUniversityName, cities: readonly string[]): string[] {
  const cityWords = new Set(cities.flatMap((city) => normalizeText(city).split(/[\s-]+/)))
  const words = name.core.filter((word) => !cityWords.has(word))
  return words.length > 0 ? words : name.core
}

/** Сжатый ключ: без пробелов, точек и дефисов — «Java Script», «java-script» → «javascript». */
export function compactKey(value: string): string {
  return normalizeText(value).replace(/[\s-]+/g, '')
}

export interface NormalizedSkillName {
  /** Нормализованное название без словаря. */
  text: string
  /** Каноническое имя после словаря синонимов. */
  canonical: string
  /** Сработал ли словарь: совпадение канонических имён тогда — синоним, а не опечатка. */
  bySynonym: boolean
}

/**
 * Название навыка для сравнения: сначала словарь целых названий по сжатому ключу
 * («K8s» → kubernetes, «1С:Предприятие» → 1с), потом — по отдельным словам
 * («Vanilla JS» → «vanilla javascript»).
 */
export function normalizeSkillName(name: string): NormalizedSkillName {
  const text = normalizeText(name)
  const whole = SKILL_SYNONYMS[compactKey(name)]
  if (whole) return { text, canonical: whole, bySynonym: whole !== text }
  const canonical = mapWords(text, SKILL_WORD_SYNONYMS)
  return { text, canonical, bySynonym: canonical !== text }
}
