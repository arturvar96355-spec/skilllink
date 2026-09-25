import { RECOMMENDATION_RULES, SKILL_GAP } from '@/shared/config/analytics.config'
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
import type { RecommendationReasonDto } from '@/shared/contracts/recommendation'
import type { SkillLevel } from '@/shared/contracts/enums'
import { daysBetween } from '@/shared/utils/date'
import { outOf100 } from '@/shared/utils/number'
import { demandNormalizer, demandPerSkill } from '@/modules/skills/skills.rules'
import { allPass, reason } from './recommendations.reasons'

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
  /**
   * Проверки правила, которые выдали эту рекомендацию (решение 119), — все пройдены.
   * Те же проверки отвечают на «почему нет рекомендации».
   */
  reasons?: RecommendationReasonDto[]
}

/**
 * Результат одного правила по одному объекту: проверки и черновик. Черновик есть
 * ровно тогда, когда пройдены все проверки, — пересборка берёт черновики,
 * «почему нет рекомендации» показывает проверки. Функция одна, логика не двоится.
 */
export interface RuleEvaluation {
  ruleKey: string
  objectType: RecommendationDraft['objectType']
  objectId: string
  checks: RecommendationReasonDto[]
  draft: RecommendationDraft | null
}

function evaluation(
  ruleKey: string,
  objectType: RecommendationDraft['objectType'],
  objectId: string,
  checks: RecommendationReasonDto[],
  build: () => RecommendationDraft | null,
): RuleEvaluation {
  const draft = allPass(checks) ? build() : null
  return { ruleKey, objectType, objectId, checks, draft: draft ? { ...draft, reasons: checks } : null }
}

/**
 * Порог «связка без движения», дней. Единственная точка чтения параметра:
 * правило, текст, проверки и ценность случая берут его отсюда, чтобы порог
 * можно было заменить (например, вычисляемым по данным) в одном месте.
 */
export function stalledDaysThreshold(): number {
  return RECOMMENDATION_RULES.stalledDays
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
export const RULE_DISPLAY_ORDER = [
  'stage.overdue',
  'skill.critical-gap-with-product',
  'cooperation.no-product',
  'program.missing-metrics',
  'cooperation.stalled',
] as const

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
 * Время создания порядок не задаёт: оно повторяет порядок, в котором база отдала
 * связки, — то есть случайный, и записи одной пересборки создаются почти в одну
 * миллисекунду. Тогда после каждой перезаливки демо-данных сверху мог бы оказаться
 * другой пункт, чем записано в сценарии.
 */
export function compareDraftsByImportance(a: RecommendationDraft, b: RecommendationDraft): number {
  const rank = (draft: RecommendationDraft) => {
    const index = (RULE_DISPLAY_ORDER as readonly string[]).indexOf(draft.ruleKey)
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
 * а не с первых полных суток. Иначе в день срока главная уже пишет
 * «просрочен… сегодня», а здесь пусто — и вместо просрочки срабатывает
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
 * говорил бы «без движения 30 дн.» о связке, где вчера закрыли три этапа, —
 * и сбрасывался бы правкой цели, где работы не было. Берётся самое позднее из трёх.
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
  const threshold = stalledDaysThreshold()
  if (idleDays < threshold) return null

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
      `Порог — ${threshold} дн.`,
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

/** Заголовок правила 3. Шаблон один — для правила и для переименования навыка. */
const criticalGapTitle = (skillName: string) => `Дефицит навыка «${skillName}» закрывается нашим продуктом`
const CRITICAL_GAP_TITLE = /^Дефицит навыка «(.*)» закрывается нашим продуктом$/su
/** Фрагмент описания правила 3, который называет навык. */
const criticalGapSkillPhrase = (skillName: string) => `продукт даёт навык «${skillName}», `

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
    title: criticalGapTitle(input.skillName),
    description:
      `Предложите вузам ${productNames}: ${criticalGapSkillPhrase(input.skillName)}` +
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

export interface SkillRecommendationText {
  ruleKey: string
  title: string
  description: string
  relatedData: unknown
}

/**
 * Рекомендация по навыку, которая называет навык иначе, чем он называется сейчас:
 * после объединения дубля (перешла на целевой навык) или переименования. Решение 110.
 *
 * Правится ровно то, что правило подставило: навык в заголовке, фраза «продукт даёт
 * навык «…»» в описании и `relatedData.skillId`. Остальное — продукты, программы,
 * обоснование — от навыка по имени не зависит и остаётся как было: пересобрать их
 * значило бы запустить все правила, а это делает генерация, не справочник.
 * Прежнее имя берётся из самого заголовка, а не с навыка: текст мог остаться
 * от ещё более раннего названия. `null` — менять нечего или текст не по шаблону
 * (его перепишет следующая генерация).
 */
export function renameSkillInRecommendation(
  row: SkillRecommendationText,
  skill: { id: string; name: string },
): { title: string; description: string; relatedData: unknown } | null {
  if (row.ruleKey !== 'skill.critical-gap-with-product') return null
  const shown = CRITICAL_GAP_TITLE.exec(row.title)?.[1]
  const related =
    row.relatedData !== null && typeof row.relatedData === 'object' && !Array.isArray(row.relatedData)
      ? (row.relatedData as Record<string, unknown>)
      : null
  const staleName = shown !== undefined && shown !== skill.name
  const staleId = related !== null && 'skillId' in related && related.skillId !== skill.id
  if (!staleName && !staleId) return null

  return {
    title: staleName ? criticalGapTitle(skill.name) : row.title,
    description: staleName
      ? // Замена функцией: в названии может быть «$», а строка-замена его толкует.
        row.description.replace(criticalGapSkillPhrase(shown), () => criticalGapSkillPhrase(skill.name))
      : row.description,
    relatedData: staleId ? { ...related, skillId: skill.id } : row.relatedData,
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
  return evaluateMissingMetrics(input).draft
}

/** Проверки правила «нет данных по программе» и его черновик. */
export function evaluateMissingMetrics(
  input: MissingMetricsInput & { cooperationCount?: number },
): RuleEvaluation {
  const missing = (
    [
      ['applicationCount', input.applicationCount],
      ['studentCount', input.studentCount],
      ['groupCount', input.groupCount],
    ] as const
  )
    .filter(([, value]) => value === null)
    .map(([key]) => key)
  const labels = missing.map((key) => PROGRAM_METRIC_LABELS[key].toLowerCase()).join(', ')

  const checks = [
    reason('program_cooperation_exists', input.hasCooperation, {
      programName: input.programName,
      cooperations: input.cooperationCount ?? (input.hasCooperation ? 1 : 0),
    }),
    reason('metrics_missing', missing.length > 0, {
      missing,
      missingCount: missing.length,
      missingLabels: labels,
    }),
  ]

  return evaluation('program.missing-metrics', 'EducationalProgram', input.programId, checks, () => ({
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
  }))
}

/** Программа в том виде, в каком её отдаёт выборка для правил. */
export type ProgramForRules = {
  id: string
  name: string
  applicationCount: number | null
  studentCount: number | null
  groupCount: number | null
  university: { name: string }
  _count: { cooperations: number }
}

/** Правило «нет данных по программе» с проверками — для пересборки, закрытия и «почему нет». */
export function evaluateProgram(program: ProgramForRules): RuleEvaluation {
  return evaluateMissingMetrics({
    programId: program.id,
    programName: program.name,
    universityName: program.university.name,
    applicationCount: program.applicationCount,
    studentCount: program.studentCount,
    groupCount: program.groupCount,
    hasCooperation: program._count.cooperations > 0,
    cooperationCount: program._count.cooperations,
  })
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
  return evaluateCooperation(cooperation, now).flatMap((item) => (item.draft ? [item.draft] : []))
}

/**
 * Три правила по связке — с проверками (решение 119). Порядок и условия те же,
 * что у пересборки: просрочка, затем застой (только без просрочки), затем продукт.
 */
export function evaluateCooperation(cooperation: CooperationRuleInput, now: Date): RuleEvaluation[] {
  const objectId = cooperation.id
  const place = { universityName: cooperation.university.name, programName: cooperation.program.name }

  // ── Просрочка: самый ранний просроченный этап, который можно начать ──
  let overdueDraft: RecommendationDraft | null = null
  let lockedStageNumber: number | null = null
  for (const stage of cooperation.stages) {
    if (!stage.deadline) continue
    if (!isOverdue(stage.deadline, stage.status, now)) continue
    // Этап за незавершённой контрольной точкой начать нельзя — просить «закройте
    // этап 7», пока не подписан договор, значит советить запрещённое.
    if (isLockedByControlPoint(stage, cooperation.stages)) {
      lockedStageNumber ??= stage.stageNumber
      continue
    }
    // Достаточно одной рекомендации о просрочке на связку: самый ранний просроченный этап.
    overdueDraft = ruleOverdueStage(
      {
        cooperationId: cooperation.id,
        ...place,
        stageNumber: stage.stageNumber,
        stageTitle: stage.title,
        status: stage.status,
        deadline: stage.deadline,
        responsibleName: stage.responsible?.fullName ?? null,
      },
      now,
    )
    if (overdueDraft) break
  }
  const overdueFacts = overdueDraft?.relatedData ?? { stageNumber: lockedStageNumber }
  const overdueChecks = [reason('stage_overdue', overdueDraft !== null || lockedStageNumber !== null, overdueFacts)]
  if (overdueDraft !== null || lockedStageNumber !== null) {
    overdueChecks.push(reason('stage_unlocked', overdueDraft !== null, overdueFacts))
  }
  const overdue = evaluation('stage.overdue', 'Cooperation', objectId, overdueChecks, () => overdueDraft)

  const current = findCurrentStage(cooperation.stages)
  const stageOpen = reason('stage_open', current !== null, {
    stageNumber: current?.stageNumber ?? null,
    stageTitle: current?.title ?? null,
  })

  // ── Застой. Просрочка уже говорит «займитесь этой связкой»: добавлять поверх неё
  // «связка без движения» — шум, два пункта об одной проблеме. ──
  const stalledChecks = [
    reason('overdue_absent', overdueDraft === null, { stageNumber: overdueDraft?.relatedData.stageNumber ?? null }),
    stageOpen,
  ]
  const lastActivityAt = lastCooperationActivity(cooperation)
  if (current) {
    const idleDays = daysBetween(lastActivityAt, now)
    stalledChecks.push(
      reason('cooperation_stalled', idleDays >= stalledDaysThreshold(), {
        idleDays,
        threshold: stalledDaysThreshold(),
        lastActivityAt: lastActivityAt.toISOString(),
      }),
    )
  }
  const stalled = evaluation('cooperation.stalled', 'Cooperation', objectId, stalledChecks, () =>
    current
      ? ruleStalledCooperation(
          {
            cooperationId: cooperation.id,
            ...place,
            stageNumber: current.stageNumber,
            stageTitle: current.title,
            stageStatus: current.status,
            lastActivityAt,
          },
          now,
        )
      : null,
  )

  // ── Связка на оформлении без продукта ──
  const productChecks = [stageOpen, reason('product_missing', cooperation.productId === null)]
  if (current) {
    productChecks.push(
      reason(
        'stage_needs_product',
        current.stageNumber >= RECOMMENDATION_RULES.productRequiredFromStage &&
          current.stageNumber < CONTROL_STAGE_NUMBER,
        { stageNumber: current.stageNumber, fromStage: RECOMMENDATION_RULES.productRequiredFromStage },
      ),
    )
  }
  const noProduct = evaluation('cooperation.no-product', 'Cooperation', objectId, productChecks, () =>
    current
      ? ruleCooperationWithoutProduct({
          cooperationId: cooperation.id,
          ...place,
          currentStageNumber: current.stageNumber,
          hasProduct: cooperation.productId !== null,
        })
      : null,
  )

  return [overdue, stalled, noProduct]
}

/**
 * Связка сдвинулась на следующий этап с момента рекомендации: текущий этап
 * теперь дальше того, о котором она говорила, или закрыты все. Для бонуса
 * «рекомендация помогла» (решение 119); у правил без номера этапа — нет.
 */
export function progressedSince(
  ruleKey: string,
  relatedData: unknown,
  currentStageNumber: number | null,
): boolean {
  if (typeof relatedData !== 'object' || relatedData === null) return false
  const data = relatedData as Record<string, unknown>
  const key = ruleKey === 'cooperation.no-product' ? 'currentStageNumber' : 'stageNumber'
  if (!(COOPERATION_RULE_KEYS as readonly string[]).includes(ruleKey)) return false
  const then = Number(data[key])
  if (!Number.isFinite(then)) return false
  return currentStageNumber === null || currentStageNumber > then
}

// ─────────────────── Дефициты навыков: все навыки разом ──────────────────────

export interface SkillGapInput {
  demand: ReadonlyArray<{ skillId: string; value: number; region: string; skill: { id: string; name: string } }>
  programs: ReadonlyArray<{ id: string; name: string; university: { name: string } }>
  programSkills: ReadonlyArray<{ programId: string; skillId: string; level: SkillLevel }>
  productSkills: ReadonlyArray<{ skillId: string; relevance: string; product: { id: string; name: string } }>
}

export interface SkillGapEvaluation {
  /** По навыку с рыночными данными — проверки и черновик (есть, если навык в числе показанных). */
  evaluations: RuleEvaluation[]
  /** Показанные дефициты — в порядке спроса. */
  shown: RecommendationDraft[]
  /** Актуальные, но за лимитом показа: их записи не закрываются как выполненные. */
  deferred: RecommendationDraft[]
}

/**
 * Правило «критичный дефицит и наш продукт» по всем навыкам сразу: спрос
 * нормируется по всем навыкам периода, а лимит показа — общий.
 *
 * Одна строка на навык — как в списке дефицитов (`demandPerSkill`): иначе два
 * региональных замера одного навыка дали бы две рекомендации с одним ключом,
 * и вторая молча затёрла бы первую.
 */
export function evaluateSkillGaps(input: SkillGapInput): SkillGapEvaluation {
  const demand = demandPerSkill(input.demand)
  const normalizeValue = demandNormalizer(demand.map((row) => row.value))

  const programsBySkill = new Map<string, Set<string>>()
  for (const row of input.programSkills) {
    const set = programsBySkill.get(row.skillId) ?? new Set<string>()
    set.add(row.programId)
    programsBySkill.set(row.skillId, set)
  }

  const productsBySkill = new Map<string, Array<{ id: string; name: string; relevance: string }>>()
  for (const row of input.productSkills) {
    const list = productsBySkill.get(row.skillId) ?? []
    list.push({ id: row.product.id, name: row.product.name, relevance: row.relevance })
    productsBySkill.set(row.skillId, list)
  }

  const candidates: Array<{ checks: RecommendationReasonDto[]; draft: RecommendationDraft; skillId: string }> = []
  const evaluations: RuleEvaluation[] = []
  for (const row of demand) {
    const normalized = normalizeValue(row.value)
    const products = productsBySkill.get(row.skillId) ?? []
    const withSkill = programsBySkill.get(row.skillId)?.size ?? 0
    // Навык считается дефицитным только если его нет НИ В ОДНОЙ программе:
    // иначе это не дефицит, а неравномерное покрытие.
    const programsWithoutSkill = input.programs.filter((program) => !programsBySkill.get(row.skillId)?.has(program.id))
    const checks = [
      reason('demand_above_threshold', normalized !== null && normalized >= SKILL_GAP.demandThreshold, {
        skillName: row.skill.name,
        demand: normalized === null ? null : outOf100(normalized),
        threshold: outOf100(SKILL_GAP.demandThreshold),
        vacancies: row.value,
      }),
      reason('skill_not_taught', input.programs.length > 0 && withSkill === 0, {
        skillName: row.skill.name,
        programs: input.programs.length,
        programsWithSkill: withSkill,
      }),
      reason('product_available', products.length > 0, {
        productNames: products.map((product) => product.name).join(', '),
      }),
    ]
    const draft = allPass(checks)
      ? ruleCriticalGapWithProduct({
          skillId: row.skillId,
          skillName: row.skill.name,
          demandNormalized: normalized ?? 0,
          products,
          programs: programsWithoutSkill.map((program) => ({
            id: program.id,
            name: program.name,
            universityName: program.university.name,
          })),
        })
      : null
    if (draft) candidates.push({ checks, draft, skillId: row.skillId })
    else evaluations.push({ ruleKey: 'skill.critical-gap-with-product', objectType: 'Skill', objectId: row.skillId, checks, draft: null })
  }

  // Самые востребованные — первыми; сортировка устойчивая, при равном спросе порядок прежний.
  candidates.sort(
    (a, b) => Number(b.draft.relatedData.demandNormalized ?? 0) - Number(a.draft.relatedData.demandNormalized ?? 0),
  )

  // Лимит ограничивает, сколько дефицитов попадёт в список за раз. Те, что за лимитом,
  // остаются актуальными: их ключи всё равно уходят в проверку на устаревание, иначе
  // система закрыла бы их как выполненные, хотя дефицит никуда не делся.
  const limit = RECOMMENDATION_RULES.criticalGapLimit
  const shown: RecommendationDraft[] = []
  const deferred: RecommendationDraft[] = []
  for (const [index, candidate] of candidates.entries()) {
    const inTop = index < limit
    const checks = [...candidate.checks, reason('gap_in_top', inTop, { rank: index + 1, limit })]
    const draft = { ...candidate.draft, reasons: checks }
    if (inTop) shown.push(draft)
    else deferred.push(draft)
    evaluations.push({
      ruleKey: 'skill.critical-gap-with-product',
      objectType: 'Skill',
      objectId: candidate.skillId,
      checks,
      draft: inTop ? draft : null,
    })
  }
  return { evaluations, shown, deferred }
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
 * нельзя закрыть, пока условие выполняется: иначе «Закрыть» уберёт просрочку
 * с главной, а этап останется просроченным. И наоборот — закрытую пересборка
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
 * Нужен при переоткрытии. Если вернулся тот же случай (например, пересборка
 * открыла закрытую запись о той же просрочке), время создания
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
