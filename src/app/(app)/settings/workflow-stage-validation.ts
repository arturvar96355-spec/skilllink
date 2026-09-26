/**
 * Проверка полей формы правки этапа шаблона workflow (ТЗ, роль «Руководитель»,
 * решение 146; решение 151 — экран).
 *
 * Тот же диапазон, что на сервере (`workflow-templates.schema.ts`,
 * `patchWorkflowStageTemplateSchema`) — проверка на клиенте только даёт быструю
 * подсказку до отправки, сервер проверяет ещё раз и остаётся источником истины.
 */

export const STAGE_TITLE_MAX_LENGTH = 200
export const NORMATIVE_DAYS_MIN = 1
export const NORMATIVE_DAYS_MAX = 3650

export type FieldValidation<T> = { ok: true; value: T } | { ok: false; error: string }

/** Название этапа: не пустое, до 200 символов (как в схеме сервера). */
export function validateStageTitle(input: string): FieldValidation<string> {
  const value = input.trim()
  if (value === '') return { ok: false, error: 'Укажите название' }
  if (value.length > STAGE_TITLE_MAX_LENGTH) {
    return { ok: false, error: `Не длиннее ${STAGE_TITLE_MAX_LENGTH} символов` }
  }
  return { ok: true, value }
}

/** Нормативный срок в днях: целое число от 1 до 3650. */
export function validateNormativeDays(input: string): FieldValidation<number> {
  const trimmed = input.trim()
  if (trimmed === '') return { ok: false, error: 'Укажите срок в днях' }
  if (!/^\d+$/.test(trimmed)) return { ok: false, error: 'Целое число дней' }

  const value = Number(trimmed)
  if (value < NORMATIVE_DAYS_MIN) return { ok: false, error: `Не меньше ${NORMATIVE_DAYS_MIN} дня` }
  if (value > NORMATIVE_DAYS_MAX) return { ok: false, error: `Не больше ${NORMATIVE_DAYS_MAX} дней` }
  return { ok: true, value }
}
