import {
  RECOMMENDATION_PRIORITIES,
  RECOMMENDATION_PRIORITY_LABELS,
  RECOMMENDATION_TRANSITIONS,
  type RecommendationDto,
  type RecommendationPriority,
  type RecommendationStatus,
} from '@/shared/contracts'
import { overdueValue, type QueueValueTone } from '@/ui/data/queue-row'
import { formatNumber } from '@/ui/lib/format'
import { summarizeAction, type ActionSummary } from '../priority-queue'

/**
 * Лента рекомендаций — та же очередь строк, что «Приоритетные действия» на
 * главной (решение 206, раскладка страницы — решение 209). Без React —
 * проверяется тестом.
 *
 * Короткие заголовок и «почему» берутся из того же `summarizeAction`, что на
 * главной: одна рекомендация читается одинаково на обоих экранах. Здесь
 * добавлено только правило просрочки этапа — на главной оно в соседнем блоке
 * «Требует внимания», поэтому своей короткой формы там не было.
 */

type SummarySource = Pick<RecommendationDto, 'ruleKey' | 'title' | 'justification' | 'relatedData' | 'target'>

export interface RowSummary extends ActionSummary {
  /** Ответственный — хвостом второй строки («Савельева О. Д.»), если правило его назвало. */
  responsible: string | null
}

function num(data: Record<string, unknown> | null, key: string): number | null {
  const value = data?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** «Ответственный: Савельева Ольга Дмитриевна.» в конце обоснования → полное ФИО. */
export function responsibleOf(justification: string): string | null {
  const match = /Ответственный:\s*([^.]+?)\.?\s*$/u.exec(justification)
  return match?.[1]?.trim() || null
}

/** «Савельева Ольга Дмитриевна» → «Савельева О. Д.»; одно слово остаётся как есть. */
export function shortPersonName(fullName: string): string {
  const [last, ...rest] = fullName.trim().split(/\s+/u)
  if (!last) return fullName
  const initials = rest.map((part) => `${part[0]!.toUpperCase()}.`).join(' ')
  return initials ? `${last} ${initials}` : last
}

/** Заголовок с глаголом и «почему» одной строкой. */
export function summarizeRecommendation(rec: SummarySource): RowSummary {
  const responsible = responsibleOf(rec.justification)
  if (rec.ruleKey === 'stage.overdue') {
    const stage = num(rec.relatedData, 'stageNumber')
    const days = num(rec.relatedData, 'daysOverdue')
    // Название этапа — после двоеточия в заголовке правила: «Просрочен этап 10: Обновление…».
    const stageTitle = /:\s*(.+)$/u.exec(rec.title)?.[1] ?? null
    if (stage !== null) {
      const when = days === null ? 'срок прошёл' : days === 0 ? 'срок истёк сегодня' : `срок прошёл ${formatNumber(days)} дн. назад`
      return {
        title: `Закрыть этап ${stage}: ${rec.target.label}`,
        why: stageTitle ? `«${stageTitle}» — ${when}` : `${when[0]!.toUpperCase()}${when.slice(1)}`,
        responsible,
      }
    }
  }
  return { ...summarizeAction(rec), responsible }
}

/** Значение справа: у просрочки — «−107 дн.», как в «Требует внимания»; у остальных — нет. */
export function rowValue(rec: Pick<RecommendationDto, 'ruleKey' | 'relatedData'>): { text: string; tone: QueueValueTone } | undefined {
  if (rec.ruleKey !== 'stage.overdue') return undefined
  const days = num(rec.relatedData, 'daysOverdue')
  return days === null ? undefined : overdueValue(days)
}

/**
 * Одно действие справа — первый переход, кроме «Отклонить»: у новой — «Принять»,
 * у записи в работе — «Закрыть», у отклонённой — «Вернуть в новые». Отклонение
 * требует основания и живёт в раскрытии строки.
 */
export function primaryTransition(status: RecommendationStatus): RecommendationStatus | null {
  return RECOMMENDATION_TRANSITIONS[status].find((next) => next !== 'DISMISSED') ?? null
}

export function canDismiss(status: RecommendationStatus): boolean {
  return RECOMMENDATION_TRANSITIONS[status].includes('DISMISSED')
}

export interface RecoGroup {
  key: RecommendationPriority | 'score'
  label: string
  items: RecommendationDto[]
}

const RANK: Record<RecommendationPriority, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 }

/** Порядок групп — от критичного к низкому, как идёт лента «сначала важное». */
export const PRIORITY_ORDER: readonly RecommendationPriority[] = [...RECOMMENDATION_PRIORITIES].sort(
  (a, b) => RANK[b] - RANK[a],
)

/**
 * Группы ленты. «Сначала важное» — по приоритету (порядок с сервера: приоритет,
 * затем балл), каждая группа со своим заголовком и числом. «По баллу» — одна
 * группа: разбивать её по приоритету значило бы сломать порядок, ради которого
 * режим выбран. Пустые группы не рисуются.
 */
export function groupRecommendations(rows: RecommendationDto[], byPriority: boolean): RecoGroup[] {
  if (!byPriority) return rows.length === 0 ? [] : [{ key: 'score', label: 'По баллу', items: rows }]
  return PRIORITY_ORDER.map((priority) => ({
    key: priority,
    label: `${RECOMMENDATION_PRIORITY_LABELS[priority]} приоритет`,
    items: rows.filter((row) => row.priority === priority),
  })).filter((group) => group.items.length > 0)
}

