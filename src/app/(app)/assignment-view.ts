import type { AssignmentDto, AssignmentStatus } from '@/shared/contracts'
import { moscowIsoDate } from '@/shared/utils/date'
import { formatDayMonth, pluralize } from '@/ui/lib/format'

/**
 * Поручения (решение 207) — чистая логика экрана: быстрые сроки, подпись срока,
 * тон полоски строки и одна кнопка смены статуса. Правило просрочки считает сервер
 * (`dueState`), здесь только слова и цвет.
 */

/** Сегодняшняя московская дата `ГГГГ-ММ-ДД` — от неё быстрые сроки и минимум поля даты. */
export function todayMoscow(now: Date = new Date()): string {
  return moscowIsoDate(now)
}

function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export type QuickDue = 'tomorrow' | 'friday' | 'week'

export const QUICK_DUE: ReadonlyArray<{ key: QuickDue; label: string }> = [
  { key: 'tomorrow', label: 'Завтра' },
  { key: 'friday', label: 'До пятницы' },
  { key: 'week', label: 'Через неделю' },
]

/**
 * Дата быстрого срока. «До пятницы» — ближайшая пятница после сегодня: в пятницу,
 * субботу и воскресенье это уже пятница следующей недели — «до пятницы», сказанное
 * в пятницу, значит не «до конца сегодня».
 */
export function quickDueDate(key: QuickDue, today: string): string {
  switch (key) {
    case 'tomorrow':
      return addDaysIso(today, 1)
    case 'week':
      return addDaysIso(today, 7)
    case 'friday': {
      const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay()
      return addDaysIso(today, (5 - weekday + 7) % 7 || 7)
    }
  }
}

/** Какой быстрый срок совпадает с выбранной датой — его кнопка подсвечена. */
export function activeQuickDue(dueDate: string, today: string): QuickDue | null {
  return QUICK_DUE.find((item) => quickDueDate(item.key, today) === dueDate)?.key ?? null
}

/** Подпись срока в строке: «просрочено на 2 дня», «сегодня», «завтра», «до 2 октября», «сделано 26 сентября». */
export function dueText(item: Pick<AssignmentDto, 'dueDate' | 'dueState' | 'daysOverdue' | 'doneAt'>): string {
  switch (item.dueState) {
    case 'overdue': {
      const days = item.daysOverdue ?? 0
      return `просрочено на ${days} ${pluralize(days, ['день', 'дня', 'дней'])}`
    }
    case 'today':
      return 'срок сегодня'
    case 'tomorrow':
      return 'срок завтра'
    case 'later':
      return `до ${formatDayMonth(item.dueDate)}`
    case 'done':
      return item.doneAt ? `сделано ${formatDayMonth(item.doneAt)}` : 'сделано'
  }
}

/**
 * Тон полоски слева (как у строки очереди, решение 206): красный — только просрочка;
 * важное — насыщенный фиолетовый, обычное — мягче, сделанное — бледно.
 */
export type AssignmentTone = 'critical' | 'accent' | 'accent-soft' | 'accent-faint'

export function assignmentTone(item: Pick<AssignmentDto, 'dueState' | 'priority'>): AssignmentTone {
  if (item.dueState === 'overdue') return 'critical'
  if (item.dueState === 'done') return 'accent-faint'
  return item.priority === 'HIGH' ? 'accent' : 'accent-soft'
}

/** Одна кнопка статуса: «Новое» → «Взять в работу», «В работе» → «Сделано», «Сделано» → «Вернуть в работу». */
export function nextStatusAction(status: AssignmentStatus): { to: AssignmentStatus; label: string } {
  switch (status) {
    case 'NEW':
      return { to: 'IN_PROGRESS', label: 'Взять в работу' }
    case 'IN_PROGRESS':
      return { to: 'DONE', label: 'Сделано' }
    case 'DONE':
      return { to: 'IN_PROGRESS', label: 'Вернуть в работу' }
  }
}

/** «МТУСИ → Программная инженерия», «МТУСИ» или `null` — поручение без привязки. */
export function placeText(item: Pick<AssignmentDto, 'university' | 'cooperation'>): string | null {
  const university = item.university ? (item.university.shortName ?? item.university.name) : null
  if (item.cooperation) return university ? `${university} → ${item.cooperation.programName}` : item.cooperation.programName
  return university
}

/** Открытые и сделанные — для вкладок «Мои поручения». */
export function splitByDone(items: readonly AssignmentDto[]): { open: AssignmentDto[]; done: AssignmentDto[] } {
  const open = items.filter((item) => item.status !== 'DONE')
  // Сделанные — свежие сверху: вчерашнее «Сделано» важнее месячной давности.
  const done = items
    .filter((item) => item.status === 'DONE')
    .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''))
  return { open, done }
}
