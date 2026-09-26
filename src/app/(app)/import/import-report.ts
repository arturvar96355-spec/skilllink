import type { ImportResultDto, ImportRowResultDto } from '@/shared/contracts'
import type { BadgeTone } from '@/ui'

/**
 * Отчёт предпросмотра импорта (задача «Данные без экрана», пункт 5) — чистая
 * логика разбора `ImportResultDto` без React, чтобы строки, счётчики и подпись
 * итога проверял тест, а не глаза на экране.
 */

export const OUTCOME_LABELS: Record<ImportRowResultDto['outcome'], string> = {
  create: 'Создастся',
  update: 'Обновится',
  unchanged: 'Без изменений',
  skip: 'Пропущена',
  error: 'Ошибка',
}

export const OUTCOME_TONES: Record<ImportRowResultDto['outcome'], BadgeTone> = {
  create: 'success',
  update: 'info',
  unchanged: 'neutral',
  skip: 'warning',
  error: 'danger',
}

/** Кодировка файла словами — Windows-1251 у Excel в Windows — обычный случай, а не ошибка. */
export function encodingLabel(encoding: ImportResultDto['encoding']): string {
  return encoding === 'windows-1251' ? 'Windows-1251' : 'UTF-8'
}

/** Итог одной строкой над таблицей — сколько строк что даст. */
export function importSummaryText(result: ImportResultDto): string {
  const parts: string[] = []
  if (result.created > 0) parts.push(`создастся ${result.created}`)
  if (result.updated > 0) parts.push(`обновится ${result.updated}`)
  if (result.unchanged > 0) parts.push(`без изменений ${result.unchanged}`)
  if (result.skipped > 0) parts.push(`пропущено ${result.skipped}`)
  if (result.errors > 0) parts.push(`ошибок ${result.errors}`)
  if (parts.length === 0) return `Всего строк: ${result.totalRows}. Файл не меняет реестр.`
  return `Всего строк: ${result.totalRows}. ${capitalize(parts.join(', '))}.`
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1)
}

/** Кнопка «Применить» имеет смысл только когда предпросмотр реально что-то изменит. */
export function hasImportChanges(result: ImportResultDto): boolean {
  return result.created > 0 || result.updated > 0
}
