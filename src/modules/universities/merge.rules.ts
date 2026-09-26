import { UNIVERSITY_MERGE } from '@/shared/config/data-quality.config'
import {
  MERGEABLE_UNIVERSITY_FIELDS,
  type MergeableUniversityField,
  type MergedObjectsCountDto,
  type MergeFieldRule,
  type SurvivorshipEntryDto,
} from '@/shared/contracts/data-quality'
import { conflict, validationError } from '@/shared/http/errors'

/**
 * Слияние вузов (решение 134): чьё значение поля остаётся, что переносится,
 * можно ли отменить. Чистые функции; транзакция — в merge.repo.ts.
 */

export type FieldValue = string | number | null

export type UniversityFields = Record<MergeableUniversityField, FieldValue>

export interface MergeSide {
  fields: UniversityFields
  updatedAt: Date
}

/** Пустое значение никогда не побеждает: null, пустая строка, строка из пробелов. */
export function isEmptyValue(value: FieldValue | undefined): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

/** «Длиннее»: у строк — по длине без краевых пробелов, у чисел — больше. */
function longer(target: FieldValue, source: FieldValue): 'target' | 'source' {
  if (isEmptyValue(source)) return 'target'
  if (isEmptyValue(target)) return 'source'
  if (typeof target === 'number' && typeof source === 'number') return source > target ? 'source' : 'target'
  return String(source).trim().length > String(target).trim().length ? 'source' : 'target'
}

export interface SurvivorshipPlan {
  entries: SurvivorshipEntryDto[]
  /** Что записать в цель: только изменившиеся поля. */
  targetUpdate: Partial<UniversityFields>
}

/**
 * Выбор значения каждого поля.
 * - `non_null`: значение цели, если оно есть, иначе источника;
 * - `most_recent`: из записи, обновлённой позже; при равенстве — цель;
 * - `longest`: длиннее (строка) или больше (число); при равенстве — цель;
 * - `manual`: то, что задал администратор.
 * Во всех правилах, кроме `manual`, пустое значение не побеждает непустое.
 */
export function planSurvivorship(
  target: MergeSide,
  source: MergeSide,
  rules: Partial<Record<MergeableUniversityField, MergeFieldRule>> = {},
  manual: Partial<UniversityFields> = {},
): SurvivorshipPlan {
  const entries: SurvivorshipEntryDto[] = []
  const targetUpdate: Partial<UniversityFields> = {}

  for (const field of MERGEABLE_UNIVERSITY_FIELDS) {
    const rule = rules[field] ?? 'non_null'
    const targetValue = target.fields[field]
    const sourceValue = source.fields[field]

    let chosen: SurvivorshipEntryDto['chosen']
    let result: FieldValue
    if (rule === 'manual') {
      chosen = 'manual'
      result = manual[field] ?? null
    } else {
      let side: 'target' | 'source'
      if (rule === 'longest') side = longer(targetValue, sourceValue)
      else if (rule === 'most_recent') {
        const sourceNewer = source.updatedAt.getTime() > target.updatedAt.getTime()
        const preferred = sourceNewer ? 'source' : 'target'
        const preferredValue = preferred === 'source' ? sourceValue : targetValue
        side = isEmptyValue(preferredValue) ? (preferred === 'source' ? 'target' : 'source') : preferred
      } else side = 'target'
      // non_null и запасной путь всех правил: пустое значение цели уступает источнику.
      if (side === 'target' && isEmptyValue(targetValue) && !isEmptyValue(sourceValue)) side = 'source'
      if (side === 'source' && isEmptyValue(sourceValue)) side = 'target'
      chosen = side
      result = side === 'source' ? sourceValue : targetValue
    }

    const changed = result !== targetValue
    if (changed) targetUpdate[field] = result
    entries.push({ field, rule, chosen, changed, targetValue, sourceValue, resultValue: result })
  }
  return { entries, targetUpdate }
}

/** Проверки до слияния: оба есть, не слиты ранее, цель не в архиве, ИНН не противоречат. */
export function assertCanMerge(
  source: { id: string; mergedIntoId: string | null; inn: string | null },
  target: { id: string; mergedIntoId: string | null; archivedAt: Date | null; inn: string | null },
): void {
  if (source.mergedIntoId) {
    throw conflict('Этот вуз уже слит с другим. Сначала отмените прежнее слияние.', { mergedIntoId: source.mergedIntoId })
  }
  if (target.mergedIntoId || target.archivedAt) {
    throw validationError('Вуз, который должен остаться, в архиве', [
      { field: 'targetId', message: 'Выберите действующий вуз или сначала верните его из архива' },
    ])
  }
  if (source.inn && target.inn && source.inn !== target.inn) {
    throw conflict('У вузов разные ИНН — это разные организации, а не дубли.', {
      sourceInn: source.inn,
      targetInn: target.inn,
    })
  }
}

/** До какого момента слияние можно отменить. */
export function undoDeadline(mergedAt: Date): Date {
  return new Date(mergedAt.getTime() + UNIVERSITY_MERGE.undoDays * 24 * 60 * 60 * 1000)
}

export function assertCanUndo(merge: { undoneAt: Date | null; undoUntil: Date }, now: Date): void {
  if (merge.undoneAt) throw conflict('Это слияние уже отменено.')
  if (now.getTime() > merge.undoUntil.getTime()) {
    throw conflict(
      `Срок отмены слияния истёк (${UNIVERSITY_MERGE.undoDays} дней). Разделить вузы теперь можно только вручную.`,
    )
  }
}

/**
 * Поля цели при отмене: возвращается значение до слияния — но только если поле
 * с тех пор не меняли. Изменённое после слияния — чьё-то решение, его не затираем.
 */
export function planUndoFields(
  entries: readonly SurvivorshipEntryDto[],
  current: UniversityFields,
): { restore: Partial<UniversityFields>; restored: MergeableUniversityField[]; kept: MergeableUniversityField[] } {
  const restore: Partial<UniversityFields> = {}
  const restored: MergeableUniversityField[] = []
  const kept: MergeableUniversityField[] = []
  for (const entry of entries) {
    if (!entry.changed) continue
    if (current[entry.field] === entry.resultValue) {
      restore[entry.field] = entry.targetValue
      restored.push(entry.field)
    } else {
      kept.push(entry.field)
    }
  }
  return { restore, restored, kept }
}

/** Идентификаторы перенесённых объектов — в журнале слияния, для отмены. */
export interface MovedIds {
  programs: string[]
  contacts: string[]
  cooperations: string[]
  meetings: string[]
  documents: string[]
  applications: string[]
  users: string[]
  /** Контакты источника, у которых снят признак «основной». */
  demotedContacts: string[]
}

export function countMoved(moved: MovedIds): MergedObjectsCountDto {
  return {
    programs: moved.programs.length,
    contacts: moved.contacts.length,
    cooperations: moved.cooperations.length,
    meetings: moved.meetings.length,
    documents: moved.documents.length,
    applications: moved.applications.length,
    users: moved.users.length,
  }
}

/** Поля, взятые не из цели, — для журнала действий (только имена, значения — в журнале слияния). */
export function fieldsTakenFromSource(entries: readonly SurvivorshipEntryDto[]): MergeableUniversityField[] {
  return entries.filter((entry) => entry.changed).map((entry) => entry.field)
}
