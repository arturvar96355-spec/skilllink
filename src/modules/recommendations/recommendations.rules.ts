import { RECOMMENDATION_RULES } from '@/shared/config/analytics.config'
import { CONTROL_STAGE_NUMBER } from '@/shared/config/workflow.config'
import {
  PROGRAM_METRIC_LABELS,
  RECOMMENDATION_STATUS_LABELS,
  RECOMMENDATION_TRANSITIONS,
} from '@/shared/contracts'
import { invalidTransition } from '@/shared/http/errors'
import {
  STATUS_LABELS as STAGE_STATUS_LABELS,
  findCurrentStage,
  isLockedByControlPoint,
  isOverdue,
} from '@/modules/workflow/workflow.rules'
import type {
  ConfidenceLevel,
  RecommendationPriority,
  RecommendationStatus,
  RecommendationType,
  StageStatus,
} from '@/shared/contracts/enums'
import { daysBetween } from '@/shared/utils/date'
import { outOf100 } from '@/shared/utils/number'

/**
 * Черновик рекомендации — результат работы правила.
 * Правила чистые: на вход получают уже собранные данные, наружу отдают описание предложения.
 * Никаких запросов к базе здесь нет, поэтому каждое правило проверяется тестом.
 */
export interface RecommendationDraft {
  ruleKey: string
  type: RecommendationType
  objectType: 'Cooperation' | 'EducationalProgram' | 'University' | 'Skill'
  objectId: string
  title: string
  description: string
  priority: RecommendationPriority
  justification: string
  relatedData: Record<string, unknown>
  confidence: ConfidenceLevel
  cooperationId: string | null
}

// ─────────────────────────── Порядок ленты ──────────────────────────────────

const PRIORITY_RANK: Record<RecommendationPriority, number> = {
  CRITICAL: 3,
  HIGH: 2,
  MEDIUM: 1,
  LOW: 0,
}

/**
 * Порядок правил при равной важности: просрочка — работа, которая уже горит;
 * дефицит навыка — то, ради чего существует продукт; дальше — оформление.
 */
const RULE_DISPLAY_ORDER = [
  'stage.overdue',
  'skill.critical-gap-with-product',
  'cooperation.no-product',
  'program.missing-metrics',
  'cooperation.stalled',
]

/** Внутри правила — сначала самое острое: давнее просроченное, самое востребованное. */
function urgency(draft: RecommendationDraft): number {
  if (draft.ruleKey === 'stage.overdue') return Number(draft.relatedData.daysOverdue ?? 0)
  if (draft.ruleKey === 'skill.critical-gap-with-product') {
    return Number(draft.relatedData.demandNormalized ?? 0)
  }
  return 0
}

/**
 * Порядок ленты рекомендаций: важность, правило, острота, затем название.
 *
 * Раньше при равной важности порядок задавало время создания, а оно повторяло
 * порядок, в котором база отдала связки, — то есть случайный. Три критичные
 * просрочки создавались в одну миллисекунду, и после каждой перезаливки
 * демо-данных сверху мог оказаться другой пункт, чем записано в сценарии.
 */
export function compareDraftsByImportance(a: RecommendationDraft, b: RecommendationDraft): number {
  const rank = (draft: RecommendationDraft) => {
    const index = RULE_DISPLAY_ORDER.indexOf(draft.ruleKey)
    return index === -1 ? RULE_DISPLAY_ORDER.length : index
  }
  return (
    PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
    rank(a) - rank(b) ||
    urgency(b) - urgency(a) ||
    a.title.localeCompare(b.title, 'ru') ||
    a.objectId.localeCompare(b.objectId)
  )
}

// ─────────────────────────── Правило 1: просроченный этап ────────────────────

export interface OverdueStageInput {
  cooperationId: string
  universityName: string
  programName: string
  stageNumber: number
  stageTitle: string
  status: StageStatus
  deadline: Date
  responsibleName: string | null
}

function overduePriority(daysOverdue: number): RecommendationPriority {
  if (daysOverdue >= RECOMMENDATION_RULES.overdueCriticalDays) return 'CRITICAL'
  if (daysOverdue >= RECOMMENDATION_RULES.overdueHighDays) return 'HIGH'
  return 'MEDIUM'
}

/**
 * Этап просрочен: срок прошёл, а этап не закрыт и не отменён.
 *
 * Просрочка — с момента срока, как на главной и в уведомлениях (`isOverdue`),
 * а не с первых полных суток. Раньше в день срока главная уже писала
 * «просрочен… сегодня», а здесь было пусто — и вместо просрочки срабатывало
 * «связка без движения», о другой проблеме и с другим советом.
 */
export function ruleOverdueStage(
  input: OverdueStageInput,
  now: Date,
): RecommendationDraft | null {
  if (input.status === 'COMPLETED' || input.status === 'CANCELLED') return null
  if (input.deadline.getTime() >= now.getTime()) return null

  // В день срока — ноль дней по московскому календарю (решение 47).
  const daysOverdue = Math.max(0, -daysBetween(now, input.deadline))

  return {
    ruleKey: 'stage.overdue',
    type: 'ACTION',
    objectType: 'Cooperation',
    objectId: input.cooperationId,
    title: `Просрочен этап ${input.stageNumber}: ${input.stageTitle}`,
    description:
      `Свяжитесь с ответственным и закройте этап либо перенесите срок с комментарием. ` +
      `Вуз: ${input.universityName}, программа: ${input.programName}.`,
    priority: overduePriority(daysOverdue),
    justification:
      (daysOverdue === 0
        ? 'Нормативный срок этапа истёк сегодня, этап всё ещё в статусе '
        : `Нормативный срок этапа прошёл ${daysOverdue} дн. назад, этап всё ещё в статусе `) +
      `«${STAGE_STATUS_LABELS[input.status]}».` +
      (input.responsibleName ? ` Ответственный: ${input.responsibleName}.` : ''),
    relatedData: {
      stageNumber: input.stageNumber,
      daysOverdue,
      deadline: input.deadline.toISOString(),
      status: input.status,
    },
    confidence: 'HIGH',
    cooperationId: input.cooperationId,
  }
}

// ────────────────────── Правило 2: связка стоит на месте ─────────────────────

export interface StalledCooperationInput {
  cooperationId: string
  universityName: string
  programName: string
  stageNumber: number
  stageTitle: string
  /** Статус текущего этапа: от него зависит, что именно предложить сделать. */
  stageStatus: StageStatus
  /**
   * Последнее движение по связке: смена статуса этапа, отметка в чек-листе
   * или правка самой связки — что позже.
   */
  lastActivityAt: Date
}

/**
 * Последнее движение по связке.
 *
 * Движение — это прежде всего работа по этапам: смена статуса и отметки
 * в чек-листе. Сама запись связки при них не меняется, поэтому её `updatedAt`
 * говорил «без движения 30 дн.» о связке, где вчера закрыли три этапа, —
 * и сбрасывался правкой цели, где работы не было. Берётся самое позднее из трёх.
 */
export function lastCooperationActivity(cooperation: {
  updatedAt: Date
  stages: ReadonlyArray<{
    history: ReadonlyArray<{ changedAt: Date }>
    tasks: ReadonlyArray<{ doneAt: Date | null }>
  }>
}): Date {
  let latest = cooperation.updatedAt
  for (const stage of cooperation.stages) {
    for (const moment of [stage.history[0]?.changedAt, stage.tasks[0]?.doneAt]) {
      if (moment && moment > latest) latest = moment
    }
  }
  return latest
}

/** Что предложить сделать, в зависимости от того, на чём связка встала. */
function stalledAction(
  status: StageStatus,
  stageNumber: number,
  stageTitle: string,
): { action: string; priority: RecommendationPriority } {
  switch (status) {
    case 'NOT_STARTED':
      return {
        action: `Начните этап ${stageNumber} «${stageTitle}» или зафиксируйте причину паузы.`,
        priority: 'MEDIUM',
      }
    case 'BLOCKED':
      return {
        action:
          `Этап ${stageNumber} «${stageTitle}» давно заблокирован. ` +
          `Эскалируйте блокировку или снимите её.`,
        priority: 'HIGH',
      }
    default:
      return {
        action:
          `Продвиньте этап ${stageNumber} «${stageTitle}» или зафиксируйте, что мешает.`,
        priority: 'MEDIUM',
      }
  }
}

/**
 * Связка стоит на месте: по ней давно не было изменений, а текущий этап не закрыт.
 *
 * Отличается от просрочки: нормативный срок может ещё не наступить, но работа не идёт.
 * Застой на заблокированном этапе получает повышенный приоритет — блокировка, которую
 * никто не снимает месяц, это не рабочее состояние.
 */
export function ruleStalledCooperation(
  input: StalledCooperationInput,
  now: Date,
): RecommendationDraft | null {
  // Закрытые этапы текущими не бывают, но защищаемся от рассинхрона данных.
  if (input.stageStatus === 'COMPLETED' || input.stageStatus === 'CANCELLED') return null

  const idleDays = daysBetween(input.lastActivityAt, now)
  if (idleDays < RECOMMENDATION_RULES.stalledDays) return null

  const { action, priority } = stalledAction(input.stageStatus, input.stageNumber, input.stageTitle)

  return {
    ruleKey: 'cooperation.stalled',
    type: 'ACTION',
    objectType: 'Cooperation',
    objectId: input.cooperationId,
    title: `Связка без движения ${idleDays} дн.`,
    description: `${action} Вуз: ${input.universityName}, программа: ${input.programName}.`,
    priority,
    justification:
      `Текущий этап ${input.stageNumber} в статусе «${STAGE_STATUS_LABELS[input.stageStatus]}», ` +
      `движения по связке — смены статуса этапа, отметки в чек-листе, правки связки — ` +
      `не было ${idleDays} дн. ` +
      `Порог — ${RECOMMENDATION_RULES.stalledDays} дн.`,
    relatedData: {
      stageNumber: input.stageNumber,
      stageStatus: input.stageStatus,
      idleDays,
      lastActivityAt: input.lastActivityAt.toISOString(),
    },
    confidence: 'MEDIUM',
    cooperationId: input.cooperationId,
  }
}

// ───────────── Правило 3: критичный дефицит навыка и подходящий продукт ──────

export interface CriticalGapInput {
  skillId: string
  skillName: string
  demandNormalized: number
  /** IT-продукты, которые дают этот навык. */
  products: Array<{ id: string; name: string; relevance: string }>
  /** Программы, которым навыка не хватает. */
  programs: Array<{ id: string; name: string; universityName: string }>
}

/**
 * Рынок просит навык, которого нет в программах, и у нас есть продукт, который его даёт.
 * Это главный сигнал системы: он соединяет аналитику навыков с работой менеджера.
 */
export function ruleCriticalGapWithProduct(input: CriticalGapInput): RecommendationDraft | null {
  if (input.products.length === 0) return null
  if (input.programs.length === 0) return null

  const productNames = input.products.map((product) => product.name).join(', ')
  const programList = input.programs
    .slice(0, 3)
    .map((program) => `${program.name} (${program.universityName})`)
    .join('; ')
  const more = input.programs.length > 3 ? ` и ещё ${input.programs.length - 3}` : ''

  return {
    ruleKey: 'skill.critical-gap-with-product',
    type: 'SKILL',
    objectType: 'Skill',
    objectId: input.skillId,
    title: `Дефицит навыка «${input.skillName}» закрывается нашим продуктом`,
    description:
      `Предложите вузам ${productNames}: продукт даёт навык «${input.skillName}», ` +
      `которого нет в программах ${programList}${more}.`,
    priority: 'HIGH',
    justification:
      `Навык востребован рынком (${outOf100(input.demandNormalized)} из 100), ` +
      `но отсутствует в ${input.programs.length} программах. ` +
      `Покрывается продуктами: ${productNames}.`,
    relatedData: {
      skillId: input.skillId,
      demandNormalized: input.demandNormalized,
      products: input.products,
      programCount: input.programs.length,
      programs: input.programs.slice(0, 10),
    },
    // Уверенность средняя: спрос считается по демонстрационному набору данных.
    confidence: 'MEDIUM',
    cooperationId: null,
  }
}

// ─────────────────── Правило 4: у программы нет показателей ──────────────────

export interface MissingMetricsInput {
  programId: string
  programName: string
  universityName: string
  applicationCount: number | null
  studentCount: number | null
  groupCount: number | null
  /** Есть ли по программе хотя бы одна связка: без неё данных взяться неоткуда. */
  hasCooperation: boolean
}


/**
 * Не заполнены показатели набора — программа выпадает из рейтинга.
 * Правило срабатывает только там, где данные реально можно получить: по программам
 * с начатым сотрудничеством. Требовать цифры у вуза, с которым не общаемся, бессмысленно.
 */
export function ruleMissingProgramMetrics(
  input: MissingMetricsInput,
): RecommendationDraft | null {
  if (!input.hasCooperation) return null

  const missing = (
    [
      ['applicationCount', input.applicationCount],
      ['studentCount', input.studentCount],
      ['groupCount', input.groupCount],
    ] as const
  )
    .filter(([, value]) => value === null)
    .map(([key]) => key)

  if (missing.length === 0) return null

  const labels = missing.map((key) => PROGRAM_METRIC_LABELS[key].toLowerCase()).join(', ')

  return {
    ruleKey: 'program.missing-metrics',
    type: 'PROGRAM',
    objectType: 'EducationalProgram',
    objectId: input.programId,
    title: `Нет данных по программе: ${labels}`,
    description:
      `Запросите у вуза ${input.universityName} недостающие показатели по программе ` +
      `«${input.programName}» или внесите их вручную.`,
    // Чем меньше данных, тем выше приоритет: без них рейтинг не считается вовсе.
    priority: missing.length === 3 ? 'HIGH' : 'MEDIUM',
    justification:
      `Не заполнено показателей: ${missing.length} из 3 (${labels}). ` +
      `Без них программа не попадает в рейтинг.`,
    relatedData: { programId: input.programId, missing },
    confidence: 'HIGH',
    cooperationId: null,
  }
}

// ───────────────── Правило 5: связка дошла до оформления без продукта ────────

export interface MissingProductInput {
  cooperationId: string
  universityName: string
  programName: string
  currentStageNumber: number
  hasProduct: boolean
}

/** На этапах оформления продукт уже должен быть выбран — иначе нечего внедрять. */
export function ruleCooperationWithoutProduct(
  input: MissingProductInput,
): RecommendationDraft | null {
  if (input.hasProduct) return null
  if (input.currentStageNumber < RECOMMENDATION_RULES.productRequiredFromStage) return null
  if (input.currentStageNumber >= CONTROL_STAGE_NUMBER) return null

  return {
    ruleKey: 'cooperation.no-product',
    type: 'ACTION',
    objectType: 'Cooperation',
    objectId: input.cooperationId,
    title: 'Связка дошла до оформления без выбранного IT-продукта',
    description:
      `Выберите IT-продукт для связки ${input.universityName} — «${input.programName}» ` +
      `или зафиксируйте, почему он не нужен.`,
    priority: 'HIGH',
    justification:
      `Текущий этап ${input.currentStageNumber}, а продукт не выбран. ` +
      `Начиная с этапа ${RECOMMENDATION_RULES.productRequiredFromStage} документы оформляются ` +
      `под конкретный продукт.`,
    relatedData: { currentStageNumber: input.currentStageNumber },
    confidence: 'HIGH',
    cooperationId: input.cooperationId,
  }
}

// ─────────────────────────── Правила по одной связке ─────────────────────────

/** Связка со всем, что нужно правилам просрочки, застоя и выбора продукта. */
export interface CooperationRuleInput {
  id: string
  productId: string | null
  updatedAt: Date
  university: { name: string }
  program: { name: string }
  stages: ReadonlyArray<{
    stageNumber: number
    title: string
    status: StageStatus
    deadline: Date | null
    responsible: { fullName: string } | null
    history: ReadonlyArray<{ changedAt: Date }>
    tasks: ReadonlyArray<{ doneAt: Date | null }>
  }>
}

/** Правила, которые смотрят на одну связку. Их рекомендации привязаны к ней. */
export const COOPERATION_RULE_KEYS = [
  'stage.overdue',
  'cooperation.stalled',
  'cooperation.no-product',
] as const

/**
 * Все рекомендации по одной связке — для пересборки, для проверки «условие
 * ещё выполняется?» при закрытии и для сверки после смены статуса этапа.
 * Одна функция на все три случая: иначе закрытие и пересборка разошлись бы
 * в том, что считать просрочкой.
 */
export function draftsForCooperation(
  cooperation: CooperationRuleInput,
  now: Date,
): RecommendationDraft[] {
  const drafts: RecommendationDraft[] = []
  let hasOverdueDraft = false

  for (const stage of cooperation.stages) {
    if (!stage.deadline) continue
    if (!isOverdue(stage.deadline, stage.status, now)) continue
    // Этап за незавершённой контрольной точкой начать нельзя — просить «закройте
    // этап 7», пока не подписан договор, значит советить запрещённое.
    if (isLockedByControlPoint(stage, cooperation.stages)) continue

    const draft = ruleOverdueStage(
      {
        cooperationId: cooperation.id,
        universityName: cooperation.university.name,
        programName: cooperation.program.name,
        stageNumber: stage.stageNumber,
        stageTitle: stage.title,
        status: stage.status,
        deadline: stage.deadline,
        responsibleName: stage.responsible?.fullName ?? null,
      },
      now,
    )
    // Достаточно одной рекомендации о просрочке на связку: самый ранний просроченный этап.
    if (draft) {
      drafts.push(draft)
      hasOverdueDraft = true
      break
    }
  }

  const current = findCurrentStage(cooperation.stages)
  if (!current) return drafts

  // Просрочка уже говорит «займитесь этой связкой». Добавлять поверх неё «связка
  // без движения» — шум: сотрудник получит два пункта об одной и той же проблеме.
  if (!hasOverdueDraft) {
    const stalled = ruleStalledCooperation(
      {
        cooperationId: cooperation.id,
        universityName: cooperation.university.name,
        programName: cooperation.program.name,
        stageNumber: current.stageNumber,
        stageTitle: current.title,
        stageStatus: current.status,
        lastActivityAt: lastCooperationActivity(cooperation),
      },
      now,
    )
    if (stalled) drafts.push(stalled)
  }

  const withoutProduct = ruleCooperationWithoutProduct({
    cooperationId: cooperation.id,
    universityName: cooperation.university.name,
    programName: cooperation.program.name,
    currentStageNumber: current.stageNumber,
    hasProduct: cooperation.productId !== null,
  })
  if (withoutProduct) drafts.push(withoutProduct)

  return drafts
}

// ─────────────────── Закрытие и переоткрытие по условию ──────────────────────

/**
 * Переход статуса рекомендации — по таблице `RECOMMENDATION_TRANSITIONS`,
 * общей с интерфейсом. Всё, чего в ней нет, — INVALID_TRANSITION, как у этапов
 * и документов.
 */
export function assertRecommendationTransition(
  from: RecommendationStatus,
  to: RecommendationStatus,
): void {
  if (from === to) {
    throw invalidTransition(
      `Рекомендация уже в статусе «${RECOMMENDATION_STATUS_LABELS[to]}»`,
      { from, to },
    )
  }
  const allowed = RECOMMENDATION_TRANSITIONS[from]
  if (allowed.includes(to)) return
  throw invalidTransition(
    `Недопустимый переход рекомендации: «${RECOMMENDATION_STATUS_LABELS[from]}» → ` +
      `«${RECOMMENDATION_STATUS_LABELS[to]}»` +
      (from === 'DONE' ? '. Если проблема вернулась, рекомендацию снова откроет пересборка.' : ''),
    { from, to, allowed },
  )
}

/**
 * Правила, чьё условие проверяется по данным прямо сейчас. Рекомендацию по ним
 * нельзя закрыть, пока условие выполняется: «Закрыть» убирала просрочку
 * с главной, а этап оставался просроченным. И наоборот — закрытую пересборка
 * открывает снова, если условие вернулось, кто бы её ни закрыл.
 *
 * Дефицит навыка сюда не входит: его действие — предложить продукт вузам,
 * а сам дефицит после этого остаётся, пока вузы не обновят программы.
 * Закрытие человеком здесь — «сделал, что предлагали», и пересборка его не трогает.
 */
export const CONDITION_CHECKED_RULES: readonly string[] = [
  ...COOPERATION_RULE_KEYS,
  'program.missing-metrics',
]

export function isConditionChecked(ruleKey: string): boolean {
  return CONDITION_CHECKED_RULES.includes(ruleKey)
}

/**
 * Закрытую рекомендацию пересборка открывает снова, если правило опять её выдаёт.
 *
 * Закрытие системой означает «проблема ушла», и её возвращение — снова новая
 * проблема. Закрытие человеком по правилу с проверяемым условием значит то же:
 * пока условие выполняется, закрыть такую сервер не даёт. Если условие снова
 * выполняется, закрытая запись — неправда о состоянии дел, кто бы её ни закрыл.
 *
 * Закрытие человеком по дефициту навыка — «предложил продукт, как советовали»,
 * сам дефицит после этого остаётся, и такое решение не переписывается.
 * Отклонённые с основанием и принятые пересборка не трогает никогда.
 */
export function shouldReopen(row: {
  status: string
  resolvedById: string | null
  ruleKey: string
}): boolean {
  if (row.status !== 'DONE') return false
  return row.resolvedById === null || isConditionChecked(row.ruleKey)
}

/**
 * Тот же ли это случай проблемы (`occurrenceOf`). Для правил, где случаи
 * не различимы, — нет: вернувшаяся проблема считается новой.
 */
export function isSameOccurrence(
  existing: { ruleKey: string; relatedData: unknown },
  draft: RecommendationDraft,
): boolean {
  const previous = occurrenceOf(existing.ruleKey, existing.relatedData)
  return previous !== null && previous === occurrenceOf(draft.ruleKey, draft.relatedData)
}

/**
 * Открытые рекомендации: их условие ещё ждёт действия. Принятая — тоже открыта:
 * «принято» при ушедшей проблеме оставляло бы в работе то, что уже неправда.
 * Отклонённая с основанием сюда не входит — это решение человека, и система
 * его не закрывает и не открывает.
 */
export const OPEN_RECOMMENDATION_STATUSES = ['NEW', 'IN_PROGRESS', 'ACCEPTED'] as const

/** Ключ рекомендации: правило и объект. По нему пересборка узнаёт свою запись. */
export function recommendationKey(row: { ruleKey: string; objectType: string; objectId: string }): string {
  return `${row.ruleKey}::${row.objectType}::${row.objectId}`
}

/** Открытые записи, которых правила больше не выдают, — их закрывает система. */
export function findObsolete(
  open: ReadonlyArray<{ id: string; ruleKey: string; objectType: string; objectId: string }>,
  actualKeys: readonly string[],
): string[] {
  const actual = new Set(actualKeys)
  return open.filter((row) => !actual.has(recommendationKey(row))).map((row) => row.id)
}

/**
 * Сверка открытых рекомендаций связки с тем, что правила выдают сейчас:
 * всё ещё правда — обновить текст, неправда — закрыть.
 */
export function planCooperationSync(
  open: ReadonlyArray<{ id: string; ruleKey: string }>,
  drafts: readonly RecommendationDraft[],
): { update: Array<{ id: string; draft: RecommendationDraft }>; close: string[] } {
  const update: Array<{ id: string; draft: RecommendationDraft }> = []
  const close: string[] = []
  for (const row of open) {
    const draft = drafts.find((item) => item.ruleKey === row.ruleKey)
    if (draft) update.push({ id: row.id, draft })
    else close.push(row.id)
  }
  return { update, close }
}

const CAN_DISMISS = 'рекомендацию можно отклонить с основанием.'

/**
 * Почему закрыть нельзя и что сделать вместо этого. `draft` — то, что правило
 * выдаёт сейчас: числа в отказе — сегодняшние, а не с момента пересборки.
 */
export function stillActualMessage(draft: RecommendationDraft): string {
  const data = draft.relatedData
  switch (draft.ruleKey) {
    case 'stage.overdue': {
      const days = Number(data.daysOverdue ?? 0)
      const late =
        days === 0
          ? `Срок этапа ${String(data.stageNumber)} истёк сегодня, этап не закрыт`
          : `Этап ${String(data.stageNumber)} всё ещё просрочен на ${days} дн.`
      return `${late} — закройте или перенесите этап; ${CAN_DISMISS}`
    }
    case 'cooperation.stalled':
      return (
        `Связка всё ещё без движения ${String(data.idleDays)} дн. — продвиньте этап ` +
        `${String(data.stageNumber)} или зафиксируйте, что мешает; ${CAN_DISMISS}`
      )
    case 'cooperation.no-product':
      return `IT-продукт для связки всё ещё не выбран — выберите продукт; ${CAN_DISMISS}`
    case 'program.missing-metrics': {
      const missing = Array.isArray(data.missing) ? (data.missing as Array<keyof typeof PROGRAM_METRIC_LABELS>) : []
      const labels = missing.map((key) => PROGRAM_METRIC_LABELS[key]?.toLowerCase() ?? key).join(', ')
      return `По программе всё ещё нет данных: ${labels} — внесите показатели; ${CAN_DISMISS}`
    }
    default:
      return `Условие рекомендации всё ещё выполняется; ${CAN_DISMISS}`
  }
}

/**
 * Какой именно случай проблемы описывает рекомендация: просрочка — этап и его
 * срок, застой — момент последнего движения. Для остальных правил случай
 * не различим — null.
 *
 * Нужен при переоткрытии. Если вернулся тот же случай (например, закрытую
 * до этого правила руками просрочку открыла пересборка), время создания
 * не сдвигается и лента уведомлений не показывает её новой: сотрудник о ней
 * уже знает. Другой этап или другой срок — новая проблема, новое уведомление.
 */
export function occurrenceOf(ruleKey: string, relatedData: unknown): string | null {
  if (typeof relatedData !== 'object' || relatedData === null) return null
  const data = relatedData as Record<string, unknown>
  if (ruleKey === 'stage.overdue') return `${String(data.stageNumber)}@${String(data.deadline)}`
  if (ruleKey === 'cooperation.stalled') return String(data.lastActivityAt)
  return null
}
