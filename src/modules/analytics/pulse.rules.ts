import { INSIGHTS } from '@/shared/config/analytics.config'
import { RECOMMENDATION_PRIORITY_LABELS } from '@/shared/contracts/labels'
import type { RecommendationPriority, RecommendationStatus, StageStatus } from '@/shared/contracts/enums'
import type {
  InsightDto,
  InsightSeverity,
  PulseDto,
  PulseItemDto,
  PulseSectionKey,
} from '@/shared/contracts/stage-analytics'
import { daysBetween } from '@/shared/utils/date'
import { countWithNoun } from '@/shared/utils/text'
import { cooperationHref, recommendationHref } from '@/ui/lib/links'
import { formatDay } from '@/modules/ai-assist/ai-assist.rules'
import { isDueSoon, isLockedByControlPoint, isOverdue } from '@/modules/workflow/workflow.rules'

/**
 * Пульс — «что у меня сейчас» (решение 120): страница «Пульс» и сводка в Telegram
 * (решение 102) из одного источника. Чистая функция от собранных данных.
 *
 * Четыре раздела:
 * - «Внимание» — просроченные и заблокированные этапы, застрявшие связки (порог —
 *   из `getStalledThreshold`), прошедшие встречи без итога, отклонения «Система заметила»;
 * - «Сегодня» — встречи и следующие действия по встречам на сегодня, этапы со сроком скоро;
 * - «Решить» — рекомендации «Новая» дольше 7 дней, затем остальные открытые;
 * - «Успехи» — этапы, закрытые за сутки.
 * Каждый пункт идёт ровно в одну группу; повторов нет: рекомендация о просрочке
 * или застое связки, уже показанной во «Внимании», второй раз не идёт.
 *
 * Сроков у документов в модели нет (документ — метаданные и статус, решение 14):
 * в «Сегодня» их нет, пока не появится поле срока.
 */

/** Незакрытый этап связки пользователя: просроченный, заблокированный или со сроком скоро. */
export interface DigestStageSource {
  stageId: string
  stageNumber: number
  stageTitle: string
  status: StageStatus
  deadline: Date | null
  cooperationId: string
  universityName: string
  programName: string
  /** Все этапы связки: по ним видно, не заперт ли этап контрольной точкой. */
  siblings: ReadonlyArray<{ stageNumber: number; title: string; status: StageStatus }>
}

/** Открытая рекомендация по связке пользователя — только названия, без текста правила. */
export interface DigestRecommendationSource {
  id: string
  ruleKey: string
  /** Номер этапа из данных правила (у просрочки он есть), иначе null. */
  stageNumber: number | null
  title: string
  /** Имя объекта: «СПбГУТ — Программная инженерия». */
  label: string
  priority: RecommendationPriority
  cooperationId: string | null
  /** Статус и дата создания — для «Новая дольше 7 дней». Нет — рекомендация просто открыта. */
  status?: RecommendationStatus
  createdAt?: Date
}

/** Связка, по которой сработало правило застоя. */
export interface PulseStalledSource {
  cooperationId: string
  stageNumber: number
  stageTitle: string
  universityName: string
  programName: string
  idleDays: number
  thresholdDays: number
  thresholdSource: 'km' | 'manual'
}

export interface PulseMeetingSource {
  meetingId: string
  topic: string
  date: Date
  nextAction: string | null
  nextActionDueAt: Date | null
  cooperationId: string | null
  /** «СПбГУТ — Программная инженерия» или вуз встречи. */
  label: string
}

export interface PulseCompletionSource {
  stageId: string
  stageNumber: number
  stageTitle: string
  cooperationId: string
  universityName: string
  programName: string
  at: Date
}

/** То, что пульс добавляет к прежней сводке. Нет — только этапы и рекомендации. */
export interface PulseExtras {
  stalled: readonly PulseStalledSource[]
  meetingsWithoutResult: readonly PulseMeetingSource[]
  meetingsToday: readonly PulseMeetingSource[]
  actionsToday: readonly PulseMeetingSource[]
  completions: readonly PulseCompletionSource[]
  /** Отклонения «Система заметила» (только warning и critical идут во «Внимание»). */
  insights: readonly InsightDto[]
  /** Сколько проверок сделал детектор. */
  insightChecks: number
}

export interface DigestSources {
  stages: readonly DigestStageSource[]
  recommendations: readonly DigestRecommendationSource[]
  extras?: PulseExtras | null
}

export type PulseKind =
  | 'stage.overdue'
  | 'stage.blocked'
  | 'cooperation.stalled'
  | 'meeting.no-result'
  | 'insight'
  | 'meeting.today'
  | 'meeting.action-due'
  | 'stage.due-soon'
  | 'recommendation.stale'
  | 'recommendation.open'
  | 'stage.completed'

/** Группа пункта: раздел и подзаголовок. Порядок ключей — порядок показа. */
export const PULSE_GROUPS: Record<PulseKind, { section: PulseSectionKey; title: string }> = {
  'stage.overdue': { section: 'attention', title: 'Просрочено' },
  'stage.blocked': { section: 'attention', title: 'Заблокировано' },
  'cooperation.stalled': { section: 'attention', title: 'Застряло дольше обычного' },
  'meeting.no-result': { section: 'attention', title: 'Встречи без итога' },
  insight: { section: 'attention', title: 'Система заметила' },
  'meeting.today': { section: 'today', title: 'Встречи сегодня' },
  'meeting.action-due': { section: 'today', title: 'Действия по встречам на сегодня' },
  'stage.due-soon': { section: 'today', title: 'Скоро срок' },
  'recommendation.stale': { section: 'decide', title: 'Ждут решения больше 7 дней' },
  'recommendation.open': { section: 'decide', title: 'Рекомендации' },
  'stage.completed': { section: 'wins', title: 'Закрыты этапы за сутки' },
}

export const PULSE_SECTIONS: ReadonlyArray<{ key: PulseSectionKey; title: string }> = [
  { key: 'attention', title: 'Внимание' },
  { key: 'today', title: 'Сегодня' },
  { key: 'decide', title: 'Решить' },
  { key: 'wins', title: 'Успехи' },
]

const BASE_KINDS: readonly PulseKind[] = [
  'stage.overdue',
  'stage.blocked',
  'stage.due-soon',
  'recommendation.stale',
  'recommendation.open',
]
const EXTRA_KINDS: readonly PulseKind[] = [
  'cooperation.stalled',
  'meeting.no-result',
  'insight',
  'meeting.today',
  'meeting.action-due',
  'stage.completed',
]

export interface PulseItem extends PulseItemDto {
  kind: PulseKind
  section: PulseSectionKey
}

export interface Pulse {
  generatedAt: Date
  checkedRules: number
  items: PulseItem[]
  /** Сколько пунктов каждого вида — до потолков. */
  counts: Record<PulseKind, number>
  isCalm: boolean
}

const PRIORITY_RANK: Record<RecommendationPriority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
const DAY_FORMS = ['день', 'дня', 'дней'] as const

function stageText(stage: DigestStageSource, tail: string): string {
  return `Этап ${stage.stageNumber} «${stage.stageTitle}», ${stage.universityName} — ${stage.programName}${tail}`
}

function item(
  kind: PulseKind,
  severity: InsightSeverity,
  text: string,
  href: string | null,
  cooperationId: string | null,
): PulseItem {
  const group = PULSE_GROUPS[kind]
  return { kind, section: group.section, group: group.title, severity, text, href, cooperationId }
}

const time = (date: Date): string =>
  new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(date)

export function buildPulse(sources: DigestSources, now: Date): Pulse {
  const items: PulseItem[] = []
  const extras = sources.extras ?? null

  // ── Этапы: просрочено → заблокировано → скоро срок (как прежняя сводка) ───
  const overdue: DigestStageSource[] = []
  const blocked: DigestStageSource[] = []
  const dueSoon: DigestStageSource[] = []
  for (const stage of sources.stages) {
    if (isLockedByControlPoint(stage, stage.siblings)) continue
    if (isOverdue(stage.deadline, stage.status, now)) overdue.push(stage)
    else if (stage.status === 'BLOCKED') blocked.push(stage)
    else if (isDueSoon(stage.deadline, stage.status, now)) dueSoon.push(stage)
  }
  const byDeadline = (a: DigestStageSource, b: DigestStageSource) =>
    (a.deadline?.getTime() ?? Infinity) - (b.deadline?.getTime() ?? Infinity) || a.stageId.localeCompare(b.stageId)
  overdue.sort(byDeadline)
  blocked.sort(byDeadline)
  dueSoon.sort(byDeadline)
  const stageHref = (stage: DigestStageSource) => cooperationHref(stage.cooperationId, stage.stageId)

  for (const stage of overdue) {
    const late = stage.deadline ? daysBetween(stage.deadline, now) : 0
    const blockedMark = stage.status === 'BLOCKED' ? ', этап заблокирован' : ''
    items.push(
      item(
        'stage.overdue',
        'critical',
        stageText(
          stage,
          `. Срок ${formatDay(stage.deadline?.toISOString() ?? null)}` +
            (late > 0 ? `, просрочка ${countWithNoun(late, DAY_FORMS)}` : '') +
            blockedMark,
        ),
        stageHref(stage),
        stage.cooperationId,
      ),
    )
  }
  for (const stage of blocked) {
    items.push(
      item(
        'stage.blocked',
        'warning',
        stageText(stage, stage.deadline ? `. Срок ${formatDay(stage.deadline.toISOString())}` : ''),
        stageHref(stage),
        stage.cooperationId,
      ),
    )
  }

  // ── Застрявшие: без связок, уже показанных просрочкой ──────────────────────
  const overdueCooperations = new Set(overdue.map((stage) => stage.cooperationId))
  const stalledCooperations = new Set<string>()
  for (const stalled of [...(extras?.stalled ?? [])].sort(
    (a, b) => b.idleDays - a.idleDays || a.cooperationId.localeCompare(b.cooperationId),
  )) {
    if (overdueCooperations.has(stalled.cooperationId)) continue
    stalledCooperations.add(stalled.cooperationId)
    const basis = stalled.thresholdSource === 'km' ? 'обычно этап проходят быстрее' : 'ручной порог'
    items.push(
      item(
        'cooperation.stalled',
        'warning',
        `Этап ${stalled.stageNumber} «${stalled.stageTitle}», ${stalled.universityName} — ${stalled.programName}. ` +
          `Без движения ${countWithNoun(stalled.idleDays, DAY_FORMS)} при пороге ${stalled.thresholdDays} (${basis})`,
        cooperationHref(stalled.cooperationId),
        stalled.cooperationId,
      ),
    )
  }

  for (const meeting of extras?.meetingsWithoutResult ?? []) {
    items.push(
      item(
        'meeting.no-result',
        'warning',
        `Встреча «${meeting.topic}» ${formatDay(meeting.date.toISOString())}, ${meeting.label}: итог не записан`,
        meeting.cooperationId ? cooperationHref(meeting.cooperationId) : null,
        meeting.cooperationId,
      ),
    )
  }
  for (const insight of extras?.insights ?? []) {
    if (insight.severity === 'info') continue
    items.push(item('insight', insight.severity, insight.title, insight.link, null))
  }

  // ── Сегодня ────────────────────────────────────────────────────────────────
  for (const meeting of extras?.meetingsToday ?? []) {
    items.push(
      item(
        'meeting.today',
        'info',
        `${time(meeting.date)} — «${meeting.topic}», ${meeting.label}`,
        meeting.cooperationId ? cooperationHref(meeting.cooperationId) : null,
        meeting.cooperationId,
      ),
    )
  }
  for (const meeting of extras?.actionsToday ?? []) {
    items.push(
      item(
        'meeting.action-due',
        'info',
        `${meeting.nextAction ?? 'Следующее действие'} — по встрече «${meeting.topic}», ${meeting.label}`,
        meeting.cooperationId ? cooperationHref(meeting.cooperationId) : null,
        meeting.cooperationId,
      ),
    )
  }
  for (const stage of dueSoon) {
    items.push(
      item(
        'stage.due-soon',
        'info',
        stageText(stage, `. Срок ${formatDay(stage.deadline?.toISOString() ?? null)}`),
        stageHref(stage),
        stage.cooperationId,
      ),
    )
  }

  // ── Решить: без повторов того, что уже во «Внимании» ───────────────────────
  const overdueKeys = new Set(overdue.map((stage) => `${stage.cooperationId}#${stage.stageNumber}`))
  const recommendations = sources.recommendations
    .filter(
      (rec) =>
        !(
          rec.ruleKey === 'stage.overdue' &&
          rec.cooperationId !== null &&
          rec.stageNumber !== null &&
          overdueKeys.has(`${rec.cooperationId}#${rec.stageNumber}`)
        ) &&
        !(rec.ruleKey === 'cooperation.stalled' && rec.cooperationId !== null && stalledCooperations.has(rec.cooperationId)),
    )
    // Порядок источника (важность, затем новые) сохраняется внутри одной важности.
    .map((rec, index) => ({ rec, index }))
    .sort((a, b) => PRIORITY_RANK[a.rec.priority] - PRIORITY_RANK[b.rec.priority] || a.index - b.index)
    .map(({ rec }) => rec)
  const recText = (rec: DigestRecommendationSource) =>
    `[${RECOMMENDATION_PRIORITY_LABELS[rec.priority]}] ${rec.title}` +
    (rec.label && rec.label !== rec.title ? ` — ${rec.label}` : '')
  const isStale = (rec: DigestRecommendationSource) =>
    rec.status === 'NEW' && rec.createdAt !== undefined && daysBetween(rec.createdAt, now) >= INSIGHTS.staleRecommendationDays
  for (const rec of recommendations.filter(isStale)) {
    const age = daysBetween(rec.createdAt!, now)
    items.push(
      item(
        'recommendation.stale',
        'warning',
        `${recText(rec)}. Без решения ${countWithNoun(age, DAY_FORMS)}`,
        recommendationHref(rec.id),
        rec.cooperationId,
      ),
    )
  }
  for (const rec of recommendations.filter((rec) => !isStale(rec))) {
    items.push(item('recommendation.open', 'info', recText(rec), recommendationHref(rec.id), rec.cooperationId))
  }

  // ── Успехи ─────────────────────────────────────────────────────────────────
  for (const done of extras?.completions ?? []) {
    items.push(
      item(
        'stage.completed',
        'info',
        `Этап ${done.stageNumber} «${done.stageTitle}», ${done.universityName} — ${done.programName}`,
        cooperationHref(done.cooperationId, done.stageId),
        done.cooperationId,
      ),
    )
  }

  const counts = Object.fromEntries(
    (Object.keys(PULSE_GROUPS) as PulseKind[]).map((kind) => [kind, items.filter((entry) => entry.kind === kind).length]),
  ) as Record<PulseKind, number>
  const checkedRules = BASE_KINDS.length + (extras ? EXTRA_KINDS.length + extras.insightChecks : 0)
  const isCalm = items.every((entry) => entry.section === 'wins')
  return { generatedAt: now, checkedRules, items, counts, isCalm }
}

/** Фраза «всё спокойно» — одна для страницы и Telegram. */
export function calmText(checkedRules: number): string {
  return (
    `Всё спокойно: проверено ${countWithNoun(checkedRules, ['правило', 'правила', 'правил'])}, ` +
    'ничего не горит — просрочек, блокировок, близких сроков и открытых рекомендаций по вашим связкам нет.'
  )
}

/** Пульс для API: разделы с потолком пунктов. */
export function toPulseDto(pulse: Pulse, perSection: number = INSIGHTS.pulsePerSection): PulseDto {
  return {
    generatedAt: pulse.generatedAt.toISOString(),
    checkedRules: pulse.checkedRules,
    isCalm: pulse.isCalm,
    calmText: pulse.isCalm ? calmText(pulse.checkedRules) : null,
    sections: PULSE_SECTIONS.map((section) => {
      const all = pulse.items.filter((entry) => entry.section === section.key)
      return {
        key: section.key,
        title: section.title,
        total: all.length,
        items: all.slice(0, perSection).map(({ section: _section, ...rest }) => rest),
      }
    }),
  }
}
