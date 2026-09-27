/**
 * Логика строки очереди (`QueueRow`) без React — проверяется тестом.
 *
 * Одна система строк на два соседних блока главной (решение 206): «Требует
 * внимания» и «Приоритетные действия». Цвет полоски слева — сигнал, а не
 * украшение: красный только у просрочки (насыщенный — у давней), всё
 * остальное — фиолетовая гамма разной силы.
 */

/**
 * Тон полоски строки.
 * - `critical` — давняя просрочка или критичный приоритет: насыщенный красный;
 * - `late` — свежая просрочка: приглушённый красный;
 * - `accent` — блокировка, высокий приоритет: фиолетовый;
 * - `accent-soft` — средний приоритет; `accent-faint` — низкий.
 */
export type QueueTone = 'critical' | 'late' | 'accent' | 'accent-soft' | 'accent-faint'

/** Цвет значения справа: просрочка — красным, «блок» — фиолетовым. */
export type QueueValueTone = 'danger' | 'accent' | 'muted'

/** Серьёзность проблемного этапа — те же значения, что `ProblemSeverity` в контракте. */
export type QueueSeverity = 'overdue-long' | 'overdue' | 'blocked'

/** Приоритет — те же значения, что `RecommendationPriority` в контракте. */
export type QueuePriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

const SEVERITY_TONE: Record<QueueSeverity, QueueTone> = {
  'overdue-long': 'critical',
  overdue: 'late',
  blocked: 'accent',
}

const PRIORITY_TONE: Record<QueuePriority, QueueTone> = {
  CRITICAL: 'critical',
  HIGH: 'accent',
  MEDIUM: 'accent-soft',
  LOW: 'accent-faint',
}

export function toneOfSeverity(severity: QueueSeverity): QueueTone {
  return SEVERITY_TONE[severity]
}

export function toneOfPriority(priority: QueuePriority): QueueTone {
  return PRIORITY_TONE[priority]
}

/** Неразрывный пробел: «−101 дн.» не должно разрываться переносом. */
const NBSP = ' '
/** Типографский минус, не дефис. */
const MINUS = '−'

/**
 * Значение справа у проблемного этапа: «−101 дн.», «сегодня», у блокировки — «блок».
 * `null` — этап заблокирован (так приходит `daysOverdue` у блокировки).
 */
export function overdueValue(daysOverdue: number | null): { text: string; tone: QueueValueTone } {
  if (daysOverdue === null) return { text: 'блок', tone: 'accent' }
  if (daysOverdue <= 0) return { text: 'сегодня', tone: 'danger' }
  return { text: `${MINUS}${daysOverdue}${NBSP}дн.`, tone: 'danger' }
}

/** Запись этапа маршрута «06 / 14» — та же, что на всей главной (07, раздел 30). */
export function stageNotation(stageNumber: number, total = 14): string {
  return `${String(stageNumber).padStart(2, '0')}${NBSP}/${NBSP}${total}`
}

/**
 * Имя строки для чтения с экрана: части через точку, пустые пропускаются.
 * Строка на экране — это несколько колонок; вслух их надо прочитать одной фразой.
 */
export function queueRowLabel(parts: ReadonlyArray<string | null | undefined | false>): string {
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .map((part) => part.replace(/[.\s]+$/u, ''))
    .join('. ')
}
