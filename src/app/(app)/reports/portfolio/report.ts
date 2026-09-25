import type {
  CooperationCountsDto,
  DashboardMetricDto,
  DashboardOverviewDto,
  MetricTrendDto,
  SkillMatchSummaryDto,
  StageWithCooperationDto,
} from '@/shared/contracts'
import { NO_DATA, formatDate, formatNumber, pluralize } from '@/ui/lib/format'

/**
 * Тексты отчёта руководителю (решение 97).
 *
 * Отдельно от страницы и без React: отчёт уходит из системы PDF-файлом,
 * и каждое число в нём должно читаться так же, как на главной, — поэтому
 * формулировки проверяются тестом, а не глазами на распечатке.
 */

/** Показатели отчёта — в этом порядке. «Операций на связку» — метрика эффекта, в отчёт не идёт. */
export const REPORT_METRIC_KEYS = [
  'activeCooperations',
  'universitiesInWork',
  'stagesOnTimePercent',
  'avgDaysToClasses',
] as const

/** Знаков после запятой — как на главной. */
const FRACTION_DIGITS: Record<string, number> = { stagesOnTimePercent: 1 }

/** Единица по числу: сервер присылает одну форму («вузов», «дней»). */
const UNIT_FORMS: Record<string, [string, string, string]> = {
  activeCooperations: ['связь', 'связи', 'связей'],
  universitiesInWork: ['вуз', 'вуза', 'вузов'],
  avgDaysToClasses: ['день', 'дня', 'дней'],
}

/** Значение показателя с единицей: «7 связей», «89,1%», «186 дней»; null — «Нет данных». */
export function metricValueText(metric: Pick<DashboardMetricDto, 'key' | 'value' | 'unit'>): string {
  if (metric.value === null) return NO_DATA
  const digits = FRACTION_DIGITS[metric.key] ?? 0
  const rounded = Number(metric.value.toFixed(digits))
  if (metric.unit === '%') return `${formatNumber(rounded)}%`
  const forms = UNIT_FORMS[metric.key]
  const unit = forms ? pluralize(rounded, forms) : metric.unit === 'шт' ? '' : metric.unit
  return unit === '' ? formatNumber(rounded) : `${formatNumber(rounded)} ${unit}`
}

/**
 * Сравнение с прошлым периодом, как на главной: «+1 за 30 дней», «−2,5 п.п. за 30 дней».
 * Без изменений — «0 за 30 дней», словами «без изменений» не пишется (ТЗ фронту, задача 1).
 */
export function trendText(trend: MetricTrendDto, isShare: boolean): string {
  if (trend.direction === 'flat') return `${isShare ? '0 п.п.' : '0'} ${trend.periodLabel}`
  const size = Math.abs(trend.delta)
  const amount = isShare ? `${formatNumber(Number(size.toFixed(1)))} п.п.` : formatNumber(size)
  const sign = trend.direction === 'up' ? '+' : '−'
  return `${sign}${amount} ${trend.periodLabel}`
}

/** «7 активных: 6 в работе, 1 черновик» — та же разбивка, что в шапке главной (решение 86). */
export function activeBreakdown(counts: CooperationCountsDto): string {
  if (counts.active === 0) return 'Активных связок нет'
  const head = `${formatNumber(counts.active)} ${pluralize(counts.active, ['активная', 'активные', 'активных'])}`
  const parts = [`${formatNumber(counts.inWork)} в работе`]
  if (counts.drafts > 0) {
    parts.push(`${formatNumber(counts.drafts)} ${pluralize(counts.drafts, ['черновик', 'черновика', 'черновиков'])}`)
  }
  return `${head}: ${parts.join(', ')}`
}

/** «В воронке 8 связок: 7 активных, 1 завершённая» — как под воронкой на главной. */
export function funnelComposition(counts: CooperationCountsDto): string {
  const parts = [`${formatNumber(counts.active)} ${pluralize(counts.active, ['активная', 'активные', 'активных'])}`]
  if (counts.paused > 0) parts.push(`${formatNumber(counts.paused)} на паузе`)
  parts.push(
    `${formatNumber(counts.completed)} ${pluralize(counts.completed, ['завершённая', 'завершённые', 'завершённых'])}`,
  )
  return `В воронке ${formatNumber(counts.total)} ${pluralize(counts.total, ['связка', 'связки', 'связок'])}: ${parts.join(', ')}`
}

/** Проблемный этап строкой отчёта. */
export interface ReportProblem {
  /** Идентификатор этапа: один этап — одна строка, даже если он и просрочен, и заблокирован. */
  key: string
  cooperationId: string
  university: string
  program: string
  stageNumber: number
  stageTitle: string
  isBlocked: boolean
  /** Сколько календарных дней прошло после срока; null — срок не вышел или его нет. */
  daysOverdue: number | null
  /** Причина блокировки; null — не заблокирован или причина скрыта. */
  blockingReason: string | null
  deadline: string | null
}

/**
 * Все проблемные этапы — из двух списков дел, `/api/workflow/overdue` и `/api/workflow/blocked`.
 *
 * Этап с вышедшим сроком в статусе «Заблокирован» есть в обоих списках —
 * в отчёте он одной строкой, причиной «заблокирован», как на главной:
 * сервер считает `problemStageTotal` по этапам, а не по вхождениям в списки.
 * Порядок — как у блока главной: по сроку, самые давние сверху, без срока — в конце.
 */
export function mergeProblemStages(
  overdue: StageWithCooperationDto[],
  blocked: StageWithCooperationDto[],
): ReportProblem[] {
  const byId = new Map<string, StageWithCooperationDto>()
  for (const stage of [...overdue, ...blocked]) byId.set(stage.id, stage)

  return [...byId.values()]
    .map((stage) => ({
      key: stage.id,
      cooperationId: stage.cooperationId,
      university: stage.universityName,
      program: stage.programName,
      stageNumber: stage.stageNumber,
      stageTitle: stage.title,
      isBlocked: stage.status === 'BLOCKED',
      // Срок вышел — решает сервер (`isOverdue`), дни — его же `daysToDeadline`:
      // те же московские сутки, что у «Этап просрочен на N дн.» на главной.
      daysOverdue: stage.isOverdue && stage.daysToDeadline !== null ? Math.max(-stage.daysToDeadline, 0) : null,
      blockingReason: stage.blockingReason,
      deadline: stage.deadline,
    }))
    .sort((a, b) => {
      if (a.deadline !== b.deadline) {
        if (a.deadline === null) return 1
        if (b.deadline === null) return -1
        return a.deadline < b.deadline ? -1 : 1
      }
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
    })
}

/**
 * Краткие названия вузов из сводки: «СПбГУТ» вместо полного имени в строке таблицы.
 *
 * Списки дел отдают только полное название, сводка — и краткое, у проблемных
 * этапов и у лучших программ. Вуза, которого в сводке нет, или вуза без
 * краткого названия в словаре нет — строка покажет полное.
 */
export function universityShortNames(
  overview: Pick<DashboardOverviewDto, 'problemCooperations' | 'topPrograms'>,
): Map<string, string> {
  const names = new Map<string, string>()
  for (const row of [...overview.problemCooperations, ...overview.topPrograms]) {
    if (row.universityShortName) names.set(row.universityName, row.universityShortName)
  }
  return names
}

/** Причина строкой: «просрочен на 57 дн.», «срок вышел сегодня», «заблокирован». */
export function problemReason(problem: Pick<ReportProblem, 'isBlocked' | 'daysOverdue'>): string {
  if (problem.isBlocked) return 'заблокирован'
  if (problem.daysOverdue === null || problem.daysOverdue === 0) return 'срок вышел сегодня'
  return `просрочен на ${formatNumber(problem.daysOverdue)} дн.`
}

/**
 * Пояснение под причиной: у заблокированного — почему и сколько он уже за сроком.
 * Заблокированный этап с вышедшим сроком — и то и другое, и руководителю важно оба.
 */
export function problemDetail(problem: ReportProblem): string | null {
  if (!problem.isBlocked) return problem.deadline ? `срок ${formatDate(problem.deadline)}` : null
  const parts: string[] = []
  if (problem.blockingReason) parts.push(problem.blockingReason)
  if (problem.daysOverdue !== null && problem.daysOverdue > 0) {
    parts.push(`срок вышел ${formatNumber(problem.daysOverdue)} дн. назад`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

/** Подпись над списком проблем: сколько этапов и из чего. */
export function problemSummary(problems: ReportProblem[]): string {
  const total = problems.length
  if (total === 0) return 'Просроченных и заблокированных этапов нет.'
  const blocked = problems.filter((problem) => problem.isBlocked).length
  const overdue = total - blocked
  const parts: string[] = []
  if (overdue > 0) parts.push(`${formatNumber(overdue)} ${pluralize(overdue, ['просрочен', 'просрочены', 'просрочены'])}`)
  if (blocked > 0) parts.push(`${formatNumber(blocked)} ${pluralize(blocked, ['заблокирован', 'заблокированы', 'заблокированы'])}`)
  return `${formatNumber(total)} ${pluralize(total, ['этап', 'этапа', 'этапов'])}: ${parts.join(', ')}.`
}

/** «16 из 18» — сколько востребованных рынком навыков есть в программах; нет рынка — «Нет данных». */
export function skillCoverageCount(skills: SkillMatchSummaryDto): string {
  if (skills.coveredSkills === null || skills.demandedSkills === null) return NO_DATA
  return `${formatNumber(skills.coveredSkills)} из ${formatNumber(skills.demandedSkills)}`
}

/** Подпись к числу критических дефицитов — по числу; нет данных — общая форма. */
export function criticalGapsLabel(count: number | null): string {
  if (count === null) return 'критических дефицитов'
  return pluralize(count, ['критический дефицит', 'критических дефицита', 'критических дефицитов'])
}

/**
 * Заголовок вкладки на время страницы — он же имя файла в «Сохранить как PDF»:
 * «Отчёт руководителю SkillLink 25.09.2026». Без двоеточий — их не любят файловые системы.
 */
export function reportDocumentTitle(generatedAt: string): string {
  return `Отчёт руководителю SkillLink ${formatDate(generatedAt)}`
}

/**
 * Одна строка внизу листа: откуда данные. Демонстрационный набор назван прямо:
 * у получателя PDF нет подсказок интерфейса, только текст на листе.
 */
export function sourceLine(overview: Pick<DashboardOverviewDto, 'skillMatch' | 'containsMockData'>): string {
  const base =
    'Данные — учёт SkillLink на момент формирования: связки, этапы и рекомендации; рейтинг программ — ' +
    `по заявкам, обучающимся и группам; спрос рынка на навыки — за период ${overview.skillMatch.period}.`
  return overview.containsMockData ? `${base} Часть данных демонстрационная и не является подтверждённой статистикой.` : base
}
