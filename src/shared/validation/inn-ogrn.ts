import { z } from '@/shared/zod'

/**
 * Проверка ИНН и ОГРН по контрольным разрядам (решение 134).
 *
 * Контрольная сумма ловит опечатку в одной цифре и большинство перестановок
 * соседних цифр — то, чем чаще всего портится номер при ручном вводе. Существование
 * организации она не проверяет: для этого нужен внешний реестр, а интеграции
 * по умолчанию выключены.
 *
 *   ИНН юрлица (10 цифр): контрольная — 10-я, веса 2 4 10 3 5 9 4 6 8.
 *   ИНН физлица и ИП (12): 11-я по весам 7 2 4 10 3 5 9 4 6 8, 12-я — по 3 7 2 4 10 3 5 9 4 6 8.
 *   Контрольная цифра = (Σ цифра × вес) mod 11 mod 10.
 *   ОГРН (13): 13-я = (число из первых 12 цифр mod 11) mod 10.
 *   ОГРНИП (15): 15-я = (число из первых 14 цифр mod 13) mod 10.
 */

const INN10_WEIGHTS = [2, 4, 10, 3, 5, 9, 4, 6, 8] as const
const INN12_WEIGHTS_11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8] as const
const INN12_WEIGHTS_12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8] as const

function digitsOf(value: string): number[] {
  return [...value].map(Number)
}

function checkDigit(digits: readonly number[], weights: readonly number[]): number {
  const sum = weights.reduce((total, weight, index) => total + weight * digits[index]!, 0)
  return (sum % 11) % 10
}

/** Остаток от деления длинного числа, записанного цифрами, — без потери точности. */
function modOfDigits(value: string, divisor: number): number {
  let rest = 0
  for (const char of value) rest = (rest * 10 + Number(char)) % divisor
  return rest
}

/** Номер из одних нулей контрольную сумму проходит, но номером не является. */
const allZeros = (value: string) => /^0+$/.test(value)

export function isValidInn(value: string): boolean {
  if (!/^(\d{10}|\d{12})$/.test(value) || allZeros(value)) return false
  const digits = digitsOf(value)
  if (value.length === 10) return checkDigit(digits, INN10_WEIGHTS) === digits[9]
  return checkDigit(digits, INN12_WEIGHTS_11) === digits[10] && checkDigit(digits, INN12_WEIGHTS_12) === digits[11]
}

/** ИНН организации — ровно 10 цифр. У вуза, как у любого юрлица, другого не бывает. */
export function isValidLegalEntityInn(value: string): boolean {
  return value.length === 10 && isValidInn(value)
}

/** ОГРН (13 цифр, юрлицо) или ОГРНИП (15 цифр, индивидуальный предприниматель). */
export function isValidOgrn(value: string): boolean {
  if (!/^(\d{13}|\d{15})$/.test(value) || allZeros(value)) return false
  const body = value.slice(0, -1)
  const control = Number(value.at(-1))
  const divisor = value.length === 13 ? 11 : 13
  return modOfDigits(body, divisor) % 10 === control
}

/** ОГРН юрлица — ровно 13 цифр. */
export function isValidLegalEntityOgrn(value: string): boolean {
  return value.length === 13 && isValidOgrn(value)
}

/**
 * Пробелы и дефисы при вводе номера — обычное дело («77 07 083893»): они снимаются
 * до проверки, в базу уходят только цифры.
 */
const digitsOnly = (value: string) => value.replace(/[\s-]/g, '')

/** ИНН организации для схем ввода: 10 цифр с верной контрольной цифрой. */
export const legalEntityInnSchema = z
  .string()
  .transform(digitsOnly)
  .refine((value) => /^\d{10}$/.test(value), 'ИНН организации — 10 цифр')
  .refine(isValidLegalEntityInn, 'Неверный ИНН: не сходится контрольная цифра — проверьте номер')

/** ОГРН организации для схем ввода: 13 цифр с верной контрольной цифрой. */
export const legalEntityOgrnSchema = z
  .string()
  .transform(digitsOnly)
  .refine((value) => /^\d{13}$/.test(value), 'ОГРН организации — 13 цифр')
  .refine(isValidLegalEntityOgrn, 'Неверный ОГРН: не сходится контрольная цифра — проверьте номер')
