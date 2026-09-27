import {
  TEAM_LOAD_LEVEL_LABELS,
  USER_ROLE_LABELS,
  type TeamLoadDto,
  type TeamLoadLevel,
  type TeamLoadRuleDto,
  type TeamMemberDto,
} from '@/shared/contracts'
import { formatDayMonth, formatRelative, pluralize } from '@/ui/lib/format'

/**
 * Экран «Команда» (решение 203) — чистые функции без React: вкладки, поиск,
 * группы и подписи. Страница только рисует то, что они вернули; проверяются тестом.
 */

export type TeamTab = 'all' | 'overloaded' | 'overdue' | 'stale'

export const TEAM_TABS: ReadonlyArray<{ key: TeamTab; label: string; test: (member: TeamMemberDto) => boolean }> = [
  { key: 'all', label: 'Все', test: () => true },
  { key: 'overloaded', label: 'Перегружены', test: (member) => member.load?.level === 'OVERLOADED' },
  { key: 'overdue', label: 'С просрочками', test: (member) => member.overdueStages > 0 },
  { key: 'stale', label: 'Без движения 7+ дней', test: (member) => member.isStale },
]

/** Вкладка из адреса (`?tab=`): незнакомое значение — «Все», а не пустой экран. */
export function parseTab(value: string | null): TeamTab {
  return TEAM_TABS.find((item) => item.key === value)?.key ?? 'all'
}

/** Поиск по ФИО, роли, должности и вузам сотрудника — все слова запроса должны найтись. */
export function matchesQuery(member: TeamMemberDto, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = [member.fullName, USER_ROLE_LABELS[member.role], member.position ?? '', ...member.universities]
    .join(' ')
    .toLowerCase()
    .replace(/ё/g, 'е')
  return words.every((word) => haystack.includes(word.replace(/ё/g, 'е')))
}

export function visibleMembers(members: readonly TeamMemberDto[], tab: TeamTab, query: string): TeamMemberDto[] {
  const test = TEAM_TABS.find((item) => item.key === tab)?.test ?? (() => true)
  return members.filter((member) => test(member) && matchesQuery(member, query))
}

/**
 * Две группы, как в макете: «Ведут связки» — по убыванию нагрузки (кому пора
 * помочь — сверху), «Не ведут связки» — по алфавиту, как пришли с сервера.
 */
export function groupMembers(members: readonly TeamMemberDto[]): { owners: TeamMemberDto[]; others: TeamMemberDto[] } {
  const owners = members
    .filter((member) => member.load !== null)
    .sort((a, b) => b.load!.points - a.load!.points || a.fullName.localeCompare(b.fullName, 'ru'))
  const others = members.filter((member) => member.load === null)
  return { owners, others }
}

export function levelLabel(level: TeamLoadLevel): string {
  return TEAM_LOAD_LEVEL_LABELS[level]
}

export const points = (value: number) => `${value} ${pluralize(value, ['балл', 'балла', 'баллов'])}`
export const cooperationsText = (value: number) => `${value} ${pluralize(value, ['связка', 'связки', 'связок'])}`
export const meetingsText = (value: number) => `${value} ${pluralize(value, ['встреча', 'встречи', 'встреч'])}`
export const overdueText = (value: number) => `${value} ${pluralize(value, ['просрочка', 'просрочки', 'просрочек'])}`

/** Подпись полосы нагрузки — для чтения с экрана и подсказки: из чего сложились баллы. */
export function loadFormula(load: TeamLoadDto, rule: TeamLoadRuleDto): string {
  return (
    `${points(load.points)}: ${cooperationsText(load.cooperations)} + ${meetingsText(load.meetings)} + ` +
    `${rule.overdueWeight} × ${overdueText(load.overdue)}. Норма до ${rule.normMax}, выше ${rule.highMax} — перегрузка.`
  )
}

/**
 * Доли полосы нагрузки на шкале до `scaleMax`: связки, встречи, просрочки подряд;
 * что не влезло в шкалу, обрезается — полоса не растёт за край.
 */
export function loadSegments(load: TeamLoadDto, rule: TeamLoadRuleDto): { cooperations: number; meetings: number; overdue: number } {
  let rest = rule.scaleMax
  const take = (value: number) => {
    const taken = Math.max(0, Math.min(value, rest))
    rest -= taken
    return (taken / rule.scaleMax) * 100
  }
  const cooperations = take(load.cooperations)
  const meetings = take(load.meetings)
  const overdue = take(rule.overdueWeight * load.overdue)
  return { cooperations, meetings, overdue }
}

/**
 * Шкала полосы на экране: правый край — `scaleMax` из конфига, а если у кого-то баллов
 * больше — наибольший балл команды, округлённый вверх до десятка. Одна шкала на все
 * строки: риски порогов стоят на одном месте, полосы сравниваются между собой, а
 * просрочка (последний отрезок) не обрезается у перегруженных.
 */
export function displayRule(rule: TeamLoadRuleDto, loads: readonly (TeamLoadDto | null)[]): TeamLoadRuleDto {
  const top = Math.max(0, ...loads.map((load) => load?.points ?? 0))
  return { ...rule, scaleMax: Math.max(rule.scaleMax, Math.ceil(top / 10) * 10) }
}

/** Положение порога на шкале в процентах. */
export function scalePosition(value: number, rule: TeamLoadRuleDto): number {
  return (Math.min(Math.max(value, 0), rule.scaleMax) / rule.scaleMax) * 100
}

/** «21–27 сент.» — неделя из ответа сервера (правая граница не включается). */
export function weekLabel(week: { from: string; to: string }): string {
  const last = new Date(new Date(week.to).getTime() - 1).toISOString()
  return `${formatDayMonth(week.from)} – ${formatDayMonth(last)}`
}

/** Последнее действие строкой: «Изменён статус этапа · ННГУ». */
export function actionText(action: { label: string; universityShortName: string | null }): string {
  return action.universityShortName ? `${action.label} · ${action.universityShortName}` : action.label
}

/** Когда: «40 минут назад», «вчера», «9 дней назад» — дальше недели дата. */
export function actionWhen(member: Pick<TeamMemberDto, 'lastAction' | 'daysSinceLastAction'>, now: number): string {
  if (!member.lastAction) return 'действий не было'
  const days = member.daysSinceLastAction
  if (days !== null && days >= 7) return `${days} ${pluralize(days, ['день', 'дня', 'дней'])} назад`
  return formatRelative(member.lastAction.at, now)
}

/** Кто связки не ведёт: объяснение словами, почему в строке нет нагрузки. */
export function noLoadReason(member: Pick<TeamMemberDto, 'canBeResponsible'>): string {
  return member.canBeResponsible
    ? 'Связки не ведёт. Может стать ответственным: роль это позволяет.'
    : 'Связки не ведёт. Ответственным быть не может: роль только для чтения и отчётов.'
}
