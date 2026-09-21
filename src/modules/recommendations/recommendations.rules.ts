import { RECOMMENDATION_RULES } from '@/shared/config/analytics.config'
import { CONTROL_STAGE_NUMBER } from '@/shared/config/workflow.config'
import { STATUS_LABELS as STAGE_STATUS_LABELS } from '@/modules/workflow/workflow.rules'
import type {
  ConfidenceLevel,
  RecommendationPriority,
  RecommendationType,
  StageStatus,
} from '@/shared/contracts/enums'
import { daysBetween } from '@/shared/utils/date'

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

/** Этап просрочен: срок прошёл, а этап не закрыт и не отменён. */
export function ruleOverdueStage(
  input: OverdueStageInput,
  now: Date,
): RecommendationDraft | null {
  if (input.status === 'COMPLETED' || input.status === 'CANCELLED') return null

  const daysOverdue = -daysBetween(now, input.deadline)
  if (daysOverdue <= 0) return null

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
      `Нормативный срок этапа прошёл ${daysOverdue} дн. назад, этап всё ещё в статусе ` +
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
  /** Когда связка последний раз менялась. */
  updatedAt: Date
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

  const idleDays = daysBetween(input.updatedAt, now)
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
      `изменений по связке не было ${idleDays} дн. ` +
      `Порог — ${RECOMMENDATION_RULES.stalledDays} дн.`,
    relatedData: {
      stageNumber: input.stageNumber,
      stageStatus: input.stageStatus,
      idleDays,
      updatedAt: input.updatedAt.toISOString(),
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
      `Навык востребован рынком (${Math.round(input.demandNormalized * 100)} из 100), ` +
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

const METRIC_LABELS: Record<string, string> = {
  applicationCount: 'заявки на обучение',
  studentCount: 'количество обучающихся',
  groupCount: 'количество параллельных групп',
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

  const labels = missing.map((key) => METRIC_LABELS[key]).join(', ')

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
