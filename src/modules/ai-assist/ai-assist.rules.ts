import { AI_ASSIST_LIMITS, AI_TODAY_ITEMS } from '@/shared/config/ai-assist.config'
import {
  COOPERATION_STATUS_LABELS,
  PROGRAM_METRIC_LABELS,
  RECOMMENDATION_PRIORITY_LABELS,
  STAGE_STATUS_LABELS,
} from '@/shared/contracts/labels'
import type { CooperationDto } from '@/shared/contracts/cooperation'
import type {
  CooperationStatus,
  RecommendationPriority,
  StageStatus,
} from '@/shared/contracts/enums'
import type { RecommendationDto } from '@/shared/contracts/recommendation'
import { isLockedByControlPoint } from '@/modules/workflow/workflow.rules'
import {
  compareDraftsByImportance,
  ruleOverdueStage,
  type RecommendationDraft,
} from '@/modules/recommendations/recommendations.rules'
import { daysBetween } from '@/shared/utils/date'
import { countWithNoun } from '@/shared/utils/text'

/**
 * Факты для ИИ-помощника (решение 90) и шаблоны без модели.
 *
 * Здесь нет ни одного нового правила о том, ЧТО делать: просрочка, её важность,
 * порядок дел — из правил рекомендаций и этапов (`recommendations.rules`,
 * `workflow.rules`). Этот файл только собирает посчитанное в факты и пишет
 * из них текст, который модель потом может переформулировать.
 */

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Europe/Moscow',
})

/** Дата по Москве, как в интерфейсе: «30.07.2026». */
export function formatDay(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : dateFormat.format(date)
}

const DAY_FORMS = ['день', 'дня', 'дней'] as const

/** Первое предложение текста правила — действие: «Свяжитесь с ответственным…». */
export function firstSentence(text: string): string {
  const [first] = text.trim().split(/(?<=[.!?])\s+/)
  return (first ?? '').trim()
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

// ─────────────────────────── Сводка по связке ───────────────────────────────

export interface StageFact {
  number: number
  title: string
  status: StageStatus
  deadline: string | null
  /** Сколько дней просрочен; 0 — срок истёк сегодня; null — не просрочен. */
  daysOverdue: number | null
  blockingReason: string | null
}

export interface SummaryFacts {
  universityName: string
  universityShortName: string | null
  programName: string
  productName: string | null
  cooperationStatus: CooperationStatus
  currentStage: StageFact | null
  /** Просроченные и заблокированные этапы, которые можно взять в работу. */
  problemStages: StageFact[]
  closedStages: number
  totalStages: number
  recommendations: Array<{ title: string; priority: RecommendationPriority; action: string }>
  classesStartAt: string | null
  /** Дней до начала занятий; отрицательное — занятия уже идут. */
  daysToClasses: number | null
}

/** Больше проблемных этапов и рекомендаций в сводку не идёт: это сводка, а не выгрузка. */
const SUMMARY_LIST_LIMIT = 5

function stageFact(stage: CooperationDto['stages'][number]): StageFact {
  return {
    number: stage.stageNumber,
    title: stage.title,
    status: stage.status,
    deadline: stage.deadline,
    daysOverdue:
      stage.isOverdue && stage.daysToDeadline !== null ? Math.max(0, -stage.daysToDeadline) : null,
    blockingReason: stage.status === 'BLOCKED' ? stage.blockingReason : null,
  }
}

/**
 * Факты сводки — из карточки связки и её открытых рекомендаций, в том виде,
 * в каком их уже посчитали сервисы.
 *
 * Не начатый этап за незавершённой контрольной точкой в проблемы не попадает —
 * по той же причине, что и в рекомендациях: начать его нельзя (решение 83).
 */
export function summaryFacts(
  cooperation: CooperationDto,
  recommendations: readonly RecommendationDto[],
  now: Date,
): SummaryFacts {
  const stages = cooperation.stages
  const current = cooperation.currentStage
    ? stages.find((stage) => stage.id === cooperation.currentStage!.id) ?? null
    : null

  const problemStages = stages
    .filter((stage) => !stage.isAutoManaged)
    .filter((stage) => stage.isOverdue || stage.status === 'BLOCKED')
    .filter((stage) => !isLockedByControlPoint(stage, stages))
    .slice(0, SUMMARY_LIST_LIMIT)
    .map(stageFact)

  return {
    universityName: cooperation.universityName,
    universityShortName: cooperation.universityShortName,
    programName: cooperation.programName,
    productName: cooperation.productName,
    cooperationStatus: cooperation.status,
    currentStage: current ? stageFact(current) : null,
    problemStages,
    closedStages: cooperation.progress.completedStages + cooperation.progress.cancelledStages,
    totalStages: cooperation.progress.totalStages,
    recommendations: recommendations.slice(0, SUMMARY_LIST_LIMIT).map((item) => ({
      title: item.title,
      priority: item.priority,
      action: firstSentence(item.description),
    })),
    classesStartAt: cooperation.classesStartAt,
    daysToClasses: cooperation.classesStartAt
      ? daysBetween(now, new Date(cooperation.classesStartAt))
      : null,
  }
}

function universityLabel(facts: { universityName: string; universityShortName: string | null }): string {
  return facts.universityShortName && facts.universityShortName !== facts.universityName
    ? `${facts.universityShortName} (${facts.universityName})`
    : facts.universityName
}

function stageProblem(stage: StageFact): string {
  const name = `этап ${stage.number} «${stage.title}»`
  const parts: string[] = []
  if (stage.daysOverdue !== null) {
    parts.push(
      stage.daysOverdue === 0
        ? 'срок истёк сегодня'
        : `просрочен на ${countWithNoun(stage.daysOverdue, DAY_FORMS)}`,
    )
  }
  if (stage.status === 'BLOCKED') {
    parts.push(`заблокирован, причина: ${stage.blockingReason?.trim() || 'не указана'}`)
  }
  return `${name} — ${parts.join(', ')}`
}

function stageLine(stage: StageFact): string {
  const deadline = formatDay(stage.deadline)
  return (
    `${stage.number} «${stage.title}», статус «${STAGE_STATUS_LABELS[stage.status]}»` +
    (deadline ? `, срок ${deadline}` : '') +
    (stage.daysOverdue === null
      ? ''
      : stage.daysOverdue === 0
        ? ', срок истёк сегодня'
        : `, просрочен на ${countWithNoun(stage.daysOverdue, DAY_FORMS)}`)
  )
}

function classesLine(facts: SummaryFacts): string {
  const date = formatDay(facts.classesStartAt)
  if (!date || facts.daysToClasses === null) return 'не указано'
  if (facts.daysToClasses > 0) return `${date}, через ${countWithNoun(facts.daysToClasses, DAY_FORMS)}`
  if (facts.daysToClasses === 0) return `${date}, сегодня`
  return `${date}, занятия уже начались`
}

/** Строки фактов сводки — то, что уходит в модель и показывается под черновиком. */
export function summaryLines(facts: SummaryFacts): string[] {
  return [
    `Вуз: ${universityLabel(facts)}`,
    `Программа: «${facts.programName}»`,
    `IT-продукт: ${facts.productName ? `«${facts.productName}»` : 'не выбран'}`,
    `Статус связки: ${COOPERATION_STATUS_LABELS[facts.cooperationStatus]}`,
    `Пройдено этапов: ${facts.closedStages} из ${facts.totalStages}`,
    `Текущий этап: ${facts.currentStage ? stageLine(facts.currentStage) : 'нет — все этапы закрыты'}`,
    `Проблемные этапы: ${
      facts.problemStages.length === 0 ? 'нет' : facts.problemStages.map(stageProblem).join('; ')
    }`,
    `Открытые рекомендации по связке: ${
      facts.recommendations.length === 0
        ? 'нет'
        : facts.recommendations
            .map(
              (item) =>
                `«${item.title}» (приоритет ${RECOMMENDATION_PRIORITY_LABELS[item.priority].toLowerCase()}), ` +
                `действие: ${item.action}`,
            )
            .join('; ')
    }`,
    `Начало занятий: ${classesLine(facts)}`,
  ]
}

/** Сводка без модели: 3–5 предложений из тех же фактов. */
export function summaryTemplate(facts: SummaryFacts): string {
  const where = `${facts.universityShortName ?? facts.universityName} — «${facts.programName}»`
  const product = facts.productName
    ? `с продуктом «${facts.productName}»`
    : 'без выбранного IT-продукта'

  const sentences: string[] = [
    facts.currentStage
      ? `Связка ${where} ${product} на этапе ${facts.currentStage.number} ` +
        `«${facts.currentStage.title}» (${STAGE_STATUS_LABELS[facts.currentStage.status].toLowerCase()}), ` +
        `пройдено ${facts.closedStages} из ${facts.totalStages} этапов.`
      : `Связка ${where} ${product}: закрыто ${facts.closedStages} из ${facts.totalStages} этапов.`,
    facts.problemStages.length === 0
      ? 'Просрочек и блокировок нет.'
      : `Мешает: ${facts.problemStages.map(stageProblem).join('; ')}.`,
  ]

  const [top] = facts.recommendations
  if (top) {
    sentences.push(`Дальше по правилам: ${lowerFirst(top.action)}`)
    if (facts.recommendations.length > 1) {
      sentences.push(`Открытых рекомендаций по связке: ${facts.recommendations.length}.`)
    }
  } else if (facts.currentStage) {
    sentences.push(`Дальше — продолжить этап ${facts.currentStage.number} «${facts.currentStage.title}».`)
  }

  const classes = classesLine(facts)
  sentences.push(
    classes === 'не указано'
      ? 'Дата начала занятий не указана.'
      : `Начало занятий: ${classes}.`,
  )

  return sentences.slice(0, 5).join(' ')
}

// ─────────────────────── Письмо вузу по рекомендации ─────────────────────────

export interface LetterFacts {
  ruleKey: string
  subject: string
  /** Кому: вуз или вузы-партнёры, без имён. */
  recipient: string
  /** Что происходит — по фактам правила. */
  situation: string
  /** Что нужно от вуза. */
  request: string
  /** Срок из данных; null — срока в данных нет, и называть его нельзя. */
  deadline: string | null
}

/** Имя навыка из подписи объекта: «Навык «Kubernetes»». */
function quoted(text: string): string | null {
  return /«(.+)»/.exec(text)?.[1] ?? null
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** «плановый срок был 30.07.2026, прошло 57 дней.» — дата и дни одной фразой. */
function overdueClause(date: string | null, daysOverdue: number | null): string {
  if (daysOverdue === 0) return date ? `плановый срок — сегодня, ${date}.` : 'плановый срок — сегодня.'
  const days = daysOverdue === null ? null : countWithNoun(daysOverdue, DAY_FORMS)
  if (date) return days ? `плановый срок был ${date}, прошло ${days}.` : `плановый срок был ${date}.`
  return days ? `плановый срок прошёл ${days} назад.` : 'плановый срок прошёл.'
}

/** Программа, к которой относится рекомендация о недостающих показателях. */
export interface ProgramLabel {
  name: string
  universityName: string
  universityShortName: string | null
}

/**
 * Факты письма: что за ситуация, что нужно от вуза и к какому сроку.
 *
 * Внутренние заметки (причины блокировок, комментарии) в письмо не попадают:
 * это переписка сотрудников ИТ-Школы, а письмо уходит вузу.
 */
export function letterFacts(
  recommendation: RecommendationDto,
  context: { cooperation: CooperationDto | null; program: ProgramLabel | null },
): LetterFacts {
  const data = recommendation.relatedData ?? {}
  const { cooperation, program } = context

  if (cooperation && (recommendation.ruleKey === 'stage.overdue' || recommendation.ruleKey === 'cooperation.stalled')) {
    const stageNumber = numberOf(data.stageNumber)
    const stage = cooperation.stages.find((item) => item.stageNumber === stageNumber) ?? null
    const title = stage?.title ?? `этап ${stageNumber ?? ''}`.trim()
    // Срок и дни — из карточки связки, то есть на сегодня; данные правила — снимок
    // на момент пересборки, и только если этапа в карточке почему-то нет.
    const deadline = stage?.deadline ?? (typeof data.deadline === 'string' ? data.deadline : null)
    const daysOverdue =
      stage?.isOverdue && stage.daysToDeadline !== null
        ? Math.max(0, -stage.daysToDeadline)
        : numberOf(data.daysOverdue)
    const idleDays = numberOf(data.idleDays)

    return {
      ruleKey: recommendation.ruleKey,
      subject: `этап «${title}» по программе «${cooperation.programName}»`,
      recipient: `представитель вуза ${cooperation.universityName}`,
      situation:
        recommendation.ruleKey === 'stage.overdue'
          ? `Совместная работа по программе «${cooperation.programName}»: этап «${title}» не завершён, ` +
            overdueClause(formatDay(deadline), daysOverdue)
          : `Совместная работа по программе «${cooperation.programName}»: по этапу «${title}» ` +
            (idleDays === null ? 'давно не было движения.' : `не было движения ${countWithNoun(idleDays, DAY_FORMS)}.`),
      request:
        recommendation.ruleKey === 'stage.overdue'
          ? `Просим сообщить, на каком шаге сейчас этап «${title}», что мешает его завершить, и согласовать новую дату завершения.`
          : `Просим сообщить, как продвигается этап «${title}» и нужна ли от нас помощь, чтобы двигаться дальше.`,
      deadline,
    }
  }

  if (cooperation && recommendation.ruleKey === 'cooperation.no-product') {
    return {
      ruleKey: recommendation.ruleKey,
      subject: `IT-продукт для программы «${cooperation.programName}»`,
      recipient: `представитель вуза ${cooperation.universityName}`,
      situation:
        `Совместная работа по программе «${cooperation.programName}» дошла до оформления документов, ` +
        'а IT-продукт ИТ-Школы РТК для программы ещё не выбран.',
      request:
        'Просим подтвердить, какой IT-продукт ИТ-Школы РТК вы рассматриваете для программы, ' +
        'или сообщить, что продукт не нужен.',
      deadline: null,
    }
  }

  if (recommendation.ruleKey === 'program.missing-metrics') {
    const missing = Array.isArray(data.missing)
      ? (data.missing as Array<keyof typeof PROGRAM_METRIC_LABELS>)
          .map((key) => PROGRAM_METRIC_LABELS[key]?.toLowerCase())
          .filter((label): label is string => typeof label === 'string')
      : []
    const programName = program?.name ?? recommendation.target.label
    return {
      ruleKey: recommendation.ruleKey,
      subject: `показатели программы «${programName}»`,
      recipient: program ? `представитель вуза ${program.universityName}` : 'представитель вуза',
      situation: `По программе «${programName}» у нас нет данных: ${missing.join(', ') || 'показатели набора'}.`,
      request:
        `Просим сообщить ${missing.join(', ') || 'показатели набора'} по программе «${programName}» ` +
        'или внести их в кабинете вуза.',
      deadline: null,
    }
  }

  if (recommendation.ruleKey === 'skill.critical-gap-with-product') {
    const skill = quoted(recommendation.target.label) ?? quoted(recommendation.title) ?? 'навык'
    const products = Array.isArray(data.products)
      ? (data.products as Array<{ name?: unknown }>)
          .map((item) => (typeof item.name === 'string' ? `«${item.name}»` : null))
          .filter((name): name is string => name !== null)
      : []
    return {
      ruleKey: recommendation.ruleKey,
      subject: `навык «${skill}» в образовательных программах`,
      recipient: 'вузы-партнёры, в программах которых нет этого навыка',
      situation: `Навык «${skill}» востребован у работодателей, а в программах вузов-партнёров его пока нет.`,
      request:
        `Предлагаем рассмотреть ${products.length > 0 ? `продукт ${products.join(', ')}` : 'продукт ИТ-Школы РТК'}: ` +
        `он даёт навык «${skill}». Просим сообщить, интересно ли это для ваших программ.`,
      deadline: null,
    }
  }

  // Правило, для которого письмо не описано отдельно: только его собственный текст.
  return {
    ruleKey: recommendation.ruleKey,
    subject: recommendation.title,
    recipient: cooperation ? `представитель вуза ${cooperation.universityName}` : 'представитель вуза',
    situation: recommendation.justification,
    request: firstSentence(recommendation.description),
    deadline: null,
  }
}

export function letterLines(facts: LetterFacts): string[] {
  const deadline = formatDay(facts.deadline)
  return [
    `Отправитель: ИТ-Школа РТК`,
    `Получатель: ${facts.recipient}`,
    `Тема: ${facts.subject}`,
    `Ситуация: ${facts.situation}`,
    `Что нужно от вуза: ${facts.request}`,
    `Срок: ${deadline ? `плановый срок этапа — ${deadline}` : 'в данных не указан, дату не называть'}`,
  ]
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Письмо без модели: вежливое, короткое, только по фактам. */
export function letterTemplate(facts: LetterFacts): string {
  const deadline = formatDay(facts.deadline)
  return [
    `Тема: ${capitalize(facts.subject)}`,
    '',
    'Уважаемые коллеги!',
    '',
    // Дата уже названа в ситуации — второй раз её не повторяем.
    `${facts.situation}${deadline && !facts.situation.includes(deadline) ? ` Плановый срок — ${deadline}.` : ''}`,
    '',
    facts.request,
    '',
    'Будем признательны за ответ.',
    '',
    'С уважением,',
    'ИТ-Школа РТК',
  ].join('\n')
}

// ─────────────────────────── «Что сделать сегодня» ───────────────────────────

/** Проблемный этап связки пользователя — как его отдаёт репозиторий. */
export interface ProblemStageInput {
  cooperationId: string
  universityId: string
  universityName: string
  universityShortName: string | null
  programName: string
  stageNumber: number
  title: string
  status: StageStatus
  deadline: Date | null
  blockingReason: string | null
  /** Все этапы связки: по ним видно, не заперт ли этап контрольной точкой. */
  siblings: ReadonlyArray<{ stageNumber: number; title: string; status: StageStatus }>
}

export interface TodayItem {
  priority: RecommendationPriority
  /** Что сделать: заголовок и действие правила. */
  action: string
  /** Почему: обоснование правила. */
  why: string
  /** К чему относится: «СПбГУТ — Программная инженерия». */
  where: string
}

interface Candidate {
  item: TodayItem
  draft: RecommendationDraft
}

function recommendationCandidate(recommendation: RecommendationDto): Candidate {
  const action = `${recommendation.title}. ${firstSentence(recommendation.description)}`
  return {
    item: {
      priority: recommendation.priority,
      action,
      why: recommendation.justification,
      where: recommendation.target.label,
    },
    // Порядок задаёт та же функция, что у ленты рекомендаций.
    draft: {
      ruleKey: recommendation.ruleKey,
      type: recommendation.type,
      objectType: recommendation.target.objectType,
      objectId: recommendation.target.objectId,
      title: recommendation.title,
      description: recommendation.description,
      priority: recommendation.priority,
      justification: recommendation.justification,
      relatedData: recommendation.relatedData ?? {},
      confidence: recommendation.confidence,
      cooperationId: recommendation.cooperationId,
    },
  }
}

/**
 * Проблемный этап как дело на сегодня. Важность просрочки — по правилу
 * `stage.overdue` (те же пороги дней), заблокированный этап — высокая, как
 * у застоя на заблокированном этапе.
 */
function stageCandidate(stage: ProblemStageInput, now: Date): Candidate | null {
  const where = `${stage.universityShortName ?? stage.universityName} — ${stage.programName}`
  const blocked = stage.status === 'BLOCKED'
  const reason = blocked ? ` Причина блокировки: ${stage.blockingReason?.trim() || 'не указана'}.` : ''

  const overdue = stage.deadline
    ? ruleOverdueStage(
        {
          cooperationId: stage.cooperationId,
          universityName: stage.universityName,
          programName: stage.programName,
          stageNumber: stage.stageNumber,
          stageTitle: stage.title,
          status: stage.status,
          deadline: stage.deadline,
          // ФИО в дело не нужно: пользователь сам ответственный.
          responsibleName: null,
        },
        now,
      )
    : null

  if (overdue) {
    return {
      item: {
        priority: overdue.priority,
        action: `${overdue.title}. ${firstSentence(overdue.description)}`,
        why: `${overdue.justification}${reason}`,
        where,
      },
      draft: overdue,
    }
  }
  if (!blocked) return null

  const title = `Заблокирован этап ${stage.stageNumber}: ${stage.title}`
  return {
    item: {
      priority: 'HIGH',
      action: `${title}. Снимите блокировку или эскалируйте её.`,
      why: reason.trim(),
      where,
    },
    draft: {
      ruleKey: 'stage.blocked',
      type: 'ACTION',
      objectType: 'Cooperation',
      objectId: stage.cooperationId,
      title,
      description: '',
      priority: 'HIGH',
      justification: reason.trim(),
      relatedData: { stageNumber: stage.stageNumber },
      confidence: 'HIGH',
      cooperationId: stage.cooperationId,
    },
  }
}

/**
 * Дела на сегодня — порядок задают правила, модель только формулирует.
 *
 * 1. Открытые рекомендации по связкам пользователя и проблемные этапы этих связок.
 *    Этап, о просрочке которого уже есть рекомендация, второй раз не идёт; этап
 *    за незавершённой контрольной точкой не идёт вовсе (решение 83).
 *    Порядок — `compareDraftsByImportance`, как у ленты рекомендаций.
 * 2. Если своих дел меньше `AI_TODAY_ITEMS.min`, добираются общие открытые
 *    рекомендации в порядке ленты — так у аналитика, у которого своих связок нет,
 *    список тоже не пустой.
 */
export function todayItems(input: {
  own: readonly RecommendationDto[]
  stages: readonly ProblemStageInput[]
  general: readonly RecommendationDto[]
  now: Date
}): TodayItem[] {
  const stageKey = (cooperationId: string | null, stageNumber: unknown) => `${cooperationId}#${String(stageNumber)}`
  const stagesByKey = new Map(input.stages.map((stage) => [stageKey(stage.cooperationId, stage.stageNumber), stage]))
  const coveredStages = new Set(
    input.own
      .filter((item) => item.ruleKey === 'stage.overdue' && item.cooperationId)
      .map((item) => stageKey(item.cooperationId, item.relatedData?.stageNumber)),
  )

  const own: Candidate[] = input.own.map((recommendation) => {
    const candidate = recommendationCandidate(recommendation)
    // Просроченный этап ещё и заблокирован — причина блокировки и есть «почему».
    const stage =
      recommendation.ruleKey === 'stage.overdue'
        ? stagesByKey.get(stageKey(recommendation.cooperationId, recommendation.relatedData?.stageNumber))
        : undefined
    if (stage?.status === 'BLOCKED') {
      candidate.item.why += ` Причина блокировки: ${stage.blockingReason?.trim() || 'не указана'}.`
    }
    return candidate
  })
  for (const stage of input.stages) {
    if (coveredStages.has(stageKey(stage.cooperationId, stage.stageNumber))) continue
    if (isLockedByControlPoint(stage, stage.siblings)) continue
    const candidate = stageCandidate(stage, input.now)
    if (candidate) own.push(candidate)
  }
  own.sort((a, b) => compareDraftsByImportance(a.draft, b.draft))

  const items = own.map((candidate) => candidate.item)
  if (items.length < AI_TODAY_ITEMS.min) {
    const taken = new Set(input.own.map((item) => item.id))
    for (const recommendation of input.general) {
      if (items.length >= AI_TODAY_ITEMS.min) break
      if (taken.has(recommendation.id)) continue
      items.push(recommendationCandidate(recommendation).item)
    }
  }
  return items.slice(0, AI_TODAY_ITEMS.max)
}

export function todayLines(items: readonly TodayItem[]): string[] {
  return items.map(
    (item, index) =>
      `${index + 1}. [${RECOMMENDATION_PRIORITY_LABELS[item.priority]} приоритет] ${item.action} ` +
      `Где: ${item.where}. Почему: ${item.why}`,
  )
}

const TASK_FORMS = ['дело', 'дела', 'дел'] as const

export function todayTemplate(items: readonly TodayItem[]): string {
  if (items.length === 0) {
    return 'На сегодня срочных дел нет: открытых рекомендаций и проблемных этапов по вашим связкам нет.'
  }
  return [
    `Что сделать сегодня — ${countWithNoun(items.length, TASK_FORMS)} в порядке важности:`,
    '',
    ...items.flatMap((item, index) => [
      `${index + 1}. ${item.action} (${item.where})`,
      `   Почему: ${item.why}`,
    ]),
  ].join('\n')
}

// ─────────────────────────── Ответ модели ────────────────────────────────────

/**
 * Приводит ответ модели к виду черновика: без разметки Markdown, без лишних
 * пустых строк, не длиннее предела. Пустая строка — ответа нет.
 */
export function cleanModelText(text: string): string {
  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/\*\*|__/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^```[a-z]*\n?|```$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return cleaned.length > AI_ASSIST_LIMITS.maxTextLength
    ? `${cleaned.slice(0, AI_ASSIST_LIMITS.maxTextLength).trimEnd()}…`
    : cleaned
}

/** Сколько пунктов списка «1. …» в тексте. */
export function countNumberedItems(text: string): number {
  return (text.match(/^\s*\d+[.)]\s/gm) ?? []).length
}
