import type { VendorContactChannel } from '@/shared/contracts/enums'
import { catalogNameKey, stripOuterQuotes } from '@/shared/utils/contacts'

/**
 * Правила загрузки вендоров (решение 132): разбор ячеек файла организаторов.
 */

/** Колонки файла вендоров — как в файле организаторов. */
export const VENDOR_COLUMNS = {
  required: ['Компания'],
  optional: ['Продукт', 'ФИО', 'Телефон', 'Почта', 'Способ связи'],
} as const

/**
 * Ячейка «Продукт» — один или несколько продуктов.
 *
 * В файле: «Базис Dynamix» или «RT.DataLake», «RT.Warehouse» — каждый продукт
 * в кавычках-ёлочках, через запятую. Запятая внутри кавычек — часть названия,
 * поэтому сначала берутся названия в кавычках. Без кавычек — делится по «;»
 * и переводу строки (запятая может быть в самом названии).
 */
export function parseProductCell(raw: string | null): string[] {
  if (!raw) return []
  const text = raw.trim()
  if (text === '') return []

  const quoted = [...text.matchAll(/[«"„“]([^«»"„“”]+)[»"“”]/g)].map((match) => match[1]!.trim()).filter(Boolean)
  const names = quoted.length > 0 ? quoted : text.split(/[;\n]/).map(stripOuterQuotes).filter(Boolean)

  // Повтор в одной ячейке — один продукт.
  const seen = new Set<string>()
  return names
    .map((name) => name.replace(/\s+/g, ' '))
    .filter((name) => {
      const key = catalogNameKey(name)
      if (key === '' || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/** Слова «Способа связи» → канал. Сравнение — без регистра и пробелов по краям. */
const CHANNEL_WORDS: ReadonlyArray<[RegExp, VendorContactChannel]> = [
  [/^(почта|e-?mail|эл\.?\s*почта|электронная почта)$/i, 'EMAIL'],
  [/^(чат в тг|тг|телеграм|телеграмм|telegram|tg|чат в telegram|чат в телеграм)$/i, 'TELEGRAM'],
  [/^(телефон|звонок|по телефону|phone)$/i, 'PHONE'],
]

/**
 * «Почта, Чат в ТГ» → [EMAIL, TELEGRAM]. Неизвестное слово — ошибка ячейки,
 * а не молчаливый пропуск: «Вотсап» не должен превратиться в «нет канала».
 */
export function parseChannels(raw: string | null): { channels: VendorContactChannel[]; unknown: string[] } {
  if (!raw || raw.trim() === '') return { channels: [], unknown: [] }
  const channels: VendorContactChannel[] = []
  const unknown: string[] = []
  for (const part of raw.split(/[,;/\n]/)) {
    const word = part.trim().replace(/\s+/g, ' ')
    if (word === '') continue
    const match = CHANNEL_WORDS.find(([pattern]) => pattern.test(word))
    if (!match) unknown.push(word)
    else if (!channels.includes(match[1])) channels.push(match[1])
  }
  return { channels, unknown }
}

/** Ключ контакта внутри вендора: ФИО без регистра и лишних пробелов. */
export function contactKey(vendorKey: string, fullName: string): string {
  return `${vendorKey}::${fullName.normalize('NFKC').toLocaleLowerCase('ru').replace(/\s+/g, ' ').trim()}`
}

/** ФИО контакта: пробелы по краям и повторные внутри убраны. */
export function normalizeFullName(raw: string | null): string | null {
  if (!raw) return null
  const text = raw.trim().replace(/\s+/g, ' ')
  return text === '' ? null : text
}

/** Совпадают ли наборы каналов без учёта порядка. */
export function sameChannels(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item))
}
