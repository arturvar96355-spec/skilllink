/**
 * Русское склонение существительного при числе.
 *
 * Нужно там, где текст собирается из числа и слова и уходит пользователю:
 * «учтено 1 из 1 программы», а не «из 1 программ».
 *
 * Формы: 1 программа, 2 программы, 5 программ.
 */
export function plural(count: number, forms: readonly [string, string, string]): string {
  // С дробным числом слово стоит в родительном падеже единственного числа:
  // «8,6 операции», «89,1 процента» — не «операций» и не «процентов».
  if (!Number.isInteger(count)) return forms[1]
  const value = Math.abs(count)
  const hundreds = value % 100
  if (hundreds > 10 && hundreds < 20) return forms[2]

  const units = value % 10
  if (units === 1) return forms[0]
  if (units >= 2 && units <= 4) return forms[1]
  return forms[2]
}

/** Число вместе со склонённым словом: `3 программы`. */
export function pluralize(count: number, forms: readonly [string, string, string]): string {
  return `${count} ${plural(count, forms)}`
}

/** Именительный падеж: «1 программа», «2 программы», «5 программ». */
export const PROGRAM_FORMS = ['программа', 'программы', 'программ'] as const

/**
 * Родительный падеж — после предлога «из»: «1 из 1 программы», «1 из 2 программ».
 * Отдельный набор нужен потому, что склонение здесь другое, а ошибка заметна
 * в каждом пояснении к рейтингу.
 */
export const PROGRAM_FORMS_OF = ['программы', 'программ', 'программ'] as const
