import type { ProblemCooperationDto, ProblemGroupsDto, ProblemSeverity } from '@/shared/contracts'
import { buildQuery } from '@/ui/lib/api'
import { formatNumber, pluralize } from '@/ui/lib/format'
import { ROUTES } from '@/ui/lib/links'

/**
 * «Требует внимания» — очередь по серьёзности (решение 206, вариант A владельца).
 *
 * Три группы: просрочены давно, просрочены недавно, заблокированы. Числа в
 * заголовках групп — по **всем** проблемным этапам (`problemGroups` с сервера),
 * строки — только показанные (самые давние по сроку). Разница честно названа
 * в подвале: «Ещё 3 заблокированных — в реестре связок».
 *
 * Без React — проверяется тестом.
 */

export interface AttentionGroup {
  key: ProblemSeverity
  label: string
  /** Сколько этапов в группе всего — с сервера, по всем этапам. */
  count: number
  rows: ProblemCooperationDto[]
}

const ORDER: ProblemSeverity[] = ['overdue-long', 'overdue', 'blocked']

/** «больше месяца» при пороге 30–31 день, иначе «больше N дней». */
function thresholdWords(days: number): string {
  if (days === 30 || days === 31) return 'месяца'
  return `${formatNumber(days)} ${pluralize(days, ['дня', 'дней', 'дней'])}`
}

export function attentionGroupLabel(key: ProblemSeverity, longOverdueDays: number): string {
  switch (key) {
    case 'overdue-long':
      return `Просрочены больше ${thresholdWords(longOverdueDays)}`
    case 'overdue':
      return `Просрочены до ${thresholdWords(longOverdueDays)}`
    case 'blocked':
      return 'Заблокированы'
  }
}

function countOf(groups: ProblemGroupsDto, key: ProblemSeverity): number {
  if (key === 'overdue-long') return groups.overdueLong
  if (key === 'overdue') return groups.overdue
  return groups.blocked
}

/**
 * Строки по группам в порядке серьёзности. Порядок внутри группы — как пришёл
 * с сервера (по сроку, самые давние сверху). Группа без показанных строк не
 * рисуется — её этапы названы в подвале.
 */
export function attentionGroups(rows: ProblemCooperationDto[], groups: ProblemGroupsDto): AttentionGroup[] {
  return ORDER.map((key) => ({
    key,
    label: attentionGroupLabel(key, groups.longOverdueDays),
    // Счётчик не меньше показанного: если данные разошлись, строки на экране важнее.
    count: Math.max(
      countOf(groups, key),
      rows.filter((row) => row.severity === key).length,
    ),
    rows: rows.filter((row) => row.severity === key),
  })).filter((group) => group.rows.length > 0)
}

/** Описание блока: «13 этапов стоят: 7 просрочены, 6 заблокированы». */
export function attentionSummary(total: number, groups: ProblemGroupsDto): string {
  if (total === 0) return 'Просроченных и заблокированных этапов нет.'
  const head = `${formatNumber(total)} ${pluralize(total, ['этап стоит', 'этапа стоят', 'этапов стоят'])}`
  const overdue = groups.overdueLong + groups.overdue
  const parts: string[] = []
  if (overdue > 0) parts.push(`${formatNumber(overdue)} ${pluralize(overdue, ['просрочен', 'просрочены', 'просрочены'])}`)
  if (groups.blocked > 0) {
    parts.push(`${formatNumber(groups.blocked)} ${pluralize(groups.blocked, ['заблокирован', 'заблокированы', 'заблокированы'])}`)
  }
  return parts.length > 0 ? `${head}: ${parts.join(', ')}.` : `${head}.`
}

/**
 * Подвал: что не вошло в показанные строки и куда за ним идти.
 * `null` — показано всё. Ссылка — реестр связок с тем фильтром, который
 * выделит именно невошедшие (только заблокированные / только просроченные).
 */
export function attentionHidden(
  rows: ProblemCooperationDto[],
  groups: ProblemGroupsDto,
): { text: string; href: string } | null {
  const shownOverdue = rows.filter((row) => row.severity !== 'blocked').length
  const shownBlocked = rows.length - shownOverdue
  const hiddenOverdue = Math.max(0, groups.overdueLong + groups.overdue - shownOverdue)
  const hiddenBlocked = Math.max(0, groups.blocked - shownBlocked)
  const hidden = hiddenOverdue + hiddenBlocked
  if (hidden === 0) return null

  if (hiddenOverdue === 0) {
    return {
      text: `Ещё ${formatNumber(hiddenBlocked)} ${pluralize(hiddenBlocked, ['заблокированный', 'заблокированных', 'заблокированных'])}`,
      href: `${ROUTES.cooperations}${buildQuery({ onlyBlocked: 'true' })}`,
    }
  }
  if (hiddenBlocked === 0) {
    return {
      text: `Ещё ${formatNumber(hiddenOverdue)} ${pluralize(hiddenOverdue, ['просроченный', 'просроченных', 'просроченных'])}`,
      href: `${ROUTES.cooperations}${buildQuery({ onlyOverdue: 'true' })}`,
    }
  }
  return {
    text: `Ещё ${formatNumber(hidden)}: ${formatNumber(hiddenOverdue)} ${pluralize(hiddenOverdue, ['просрочен', 'просрочены', 'просрочены'])}, ${formatNumber(hiddenBlocked)} ${pluralize(hiddenBlocked, ['заблокирован', 'заблокированы', 'заблокированы'])}`,
    href: ROUTES.cooperations,
  }
}
