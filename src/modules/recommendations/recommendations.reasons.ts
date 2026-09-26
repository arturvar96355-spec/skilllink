import type { RecommendationReasonDto } from '@/shared/contracts/recommendation'
import { plural } from '@/shared/utils/text'

/**
 * Причины рекомендаций и проверки «почему нет» (решение 119).
 *
 * Код причины — `<предмет>_<состояние>`: что проверяется. `pass` — выполнено ли
 * условие, которое нужно правилу. Тексты — только здесь, одним словарём, и только
 * из фактов проверки: одна и та же причина в ленте, в карточке и в «почему нет»
 * звучит одинаково.
 */

export const REASON_CODES = [
  // Общие для всех правил.
  'rule_enabled',
  'dismissed_recently',
  // Связка.
  'cooperation_open',
  'stage_overdue',
  'stage_unlocked',
  'overdue_absent',
  'stage_open',
  'cooperation_stalled',
  'product_missing',
  'stage_needs_product',
  // Программа.
  'program_active',
  'program_cooperation_exists',
  'metrics_missing',
  // Навык.
  'demand_above_threshold',
  'skill_not_taught',
  'product_available',
  'gap_in_top',
  // Обучение: не условие правила, а пометки к баллу.
  'rule_weight_low',
  'manager_overloaded',
] as const

export type ReasonCode = (typeof REASON_CODES)[number]

/** Пометки обучения: пересчёт балла переписывает их, не трогая проверки правила. */
export const LEARNING_REASON_CODES: readonly ReasonCode[] = ['rule_weight_low', 'manager_overloaded']

export type Facts = Record<string, unknown>

interface ReasonText {
  label: string
  pass: (facts: Facts) => string
  fail: (facts: Facts) => string
}

const str = (value: unknown) => String(value ?? '—')
const num = (value: unknown) => Number(value ?? 0)
const days = (value: unknown) => `${num(value)} дн.`
const share = (value: unknown) => num(value).toFixed(2).replace('.', ',')
const percent = (value: unknown) => `${Math.round(num(value) * 100)} %`
const date = (value: unknown) =>
  typeof value === 'string' || value instanceof Date
    ? new Date(value).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })
    : '—'
const count = (value: unknown, forms: readonly [string, string, string]) => `${num(value)} ${plural(num(value), forms)}`

const RULE_LABELS: Record<string, string> = {
  'stage.overdue': 'Просроченный этап',
  'cooperation.stalled': 'Связка без движения',
  'cooperation.no-product': 'Связка без IT-продукта',
  'program.missing-metrics': 'Нет данных по программе',
  'skill.critical-gap-with-product': 'Критичный дефицит и наш продукт',
}

export function ruleLabel(ruleKey: string): string {
  return RULE_LABELS[ruleKey] ?? ruleKey
}

export const REASON_TEXTS: Record<ReasonCode, ReasonText> = {
  rule_enabled: {
    label: 'Правило включено',
    pass: (f) => `Правило «${str(f.ruleLabel)}» включено`,
    fail: (f) => `Правило «${str(f.ruleLabel)}» выключено в настройках`,
  },
  dismissed_recently: {
    label: 'Пауза после отклонения',
    pass: (f) =>
      f.daysAgo === null || f.daysAgo === undefined
        ? 'Рекомендацию по этому объекту не отклоняли'
        : `Отклонена ${days(f.daysAgo)} назад, пауза ${days(f.pauseDays)} кончилась`,
    fail: (f) => `Отклонена ${days(f.daysAgo)} назад, пауза до ${date(f.until)}`,
  },
  cooperation_open: {
    label: 'Связка в работе',
    pass: () => 'Связка не завершена и не отменена',
    fail: (f) => `Связка ${str(f.statusLabel ?? 'закрыта')} — правила по ней не работают`,
  },
  stage_overdue: {
    label: 'Этап просрочен',
    pass: (f) =>
      num(f.daysOverdue) === 0
        ? `Срок этапа ${num(f.stageNumber)} истёк сегодня, этап не закрыт`
        : `Этап ${num(f.stageNumber)} просрочен на ${days(f.daysOverdue)}`,
    fail: () => 'Ни один начатый этап не просрочен',
  },
  stage_unlocked: {
    label: 'Этап можно начать',
    pass: (f) => `Этап ${num(f.stageNumber)} не стоит за контрольной точкой`,
    fail: (f) => `Просроченный этап ${num(f.stageNumber)} стоит за незавершённой контрольной точкой — начать его нельзя`,
  },
  overdue_absent: {
    label: 'Нет рекомендации о просрочке',
    pass: () => 'По связке нет просрочки — застой не дублирует её',
    fail: (f) => `По связке уже есть рекомендация о просрочке этапа ${num(f.stageNumber)} — застой её не дублирует`,
  },
  stage_open: {
    label: 'Есть текущий этап',
    pass: (f) => `Текущий этап ${num(f.stageNumber)} «${str(f.stageTitle)}» не закрыт`,
    fail: () => 'Все этапы закрыты — текущего этапа нет',
  },
  cooperation_stalled: {
    label: 'Связка без движения',
    pass: (f) => `Связка без движения ${days(f.idleDays)} при пороге ${days(f.threshold)}`,
    fail: (f) => `Последнее движение ${days(f.idleDays)} назад — меньше порога ${days(f.threshold)}`,
  },
  product_missing: {
    label: 'Продукт не выбран',
    pass: () => 'IT-продукт для связки не выбран',
    fail: () => 'IT-продукт для связки выбран',
  },
  stage_needs_product: {
    label: 'Этап оформления',
    pass: (f) => `Текущий этап ${num(f.stageNumber)} — с этапа ${num(f.fromStage)} документы оформляются под продукт`,
    fail: (f) =>
      num(f.stageNumber) < num(f.fromStage)
        ? `Текущий этап ${num(f.stageNumber)} — продукт нужен только с этапа ${num(f.fromStage)}`
        : `Связка дошла до контроля выполнения (этап ${num(f.stageNumber)}) — выбирать продукт поздно`,
  },
  program_active: {
    label: 'Программа действует',
    pass: (f) => `Программа «${str(f.programName)}» действует`,
    fail: (f) => `Программа «${str(f.programName)}» не действует (черновик или в архиве)`,
  },
  program_cooperation_exists: {
    label: 'Есть сотрудничество',
    pass: (f) =>
      `У программы «${str(f.programName)}» ${count(f.cooperations, ['действующее сотрудничество', 'действующих сотрудничества', 'действующих сотрудничеств'])}`,
    fail: (f) =>
      `У программы «${str(f.programName)}» 0 действующих сотрудничеств — запрашивать показатели не у кого`,
  },
  metrics_missing: {
    label: 'Не заполнены показатели',
    pass: (f) => `Не заполнено ${num(f.missingCount)} из 3 показателей: ${str(f.missingLabels)}`,
    fail: () => 'Все три показателя программы заполнены',
  },
  demand_above_threshold: {
    label: 'Спрос выше порога',
    pass: (f) =>
      `Навык ${str(f.skillName)} нужен рынку на ${num(f.demand)} из 100 при пороге ${num(f.threshold)}` +
      (f.vacancies !== undefined && f.vacancies !== null ? ` (${num(f.vacancies)} в замере)` : ''),
    fail: (f) =>
      f.demand === null || f.demand === undefined
        ? `По навыку ${str(f.skillName)} нет рыночных данных за последний период`
        : `Спрос на навык ${str(f.skillName)} — ${num(f.demand)} из 100, ниже порога ${num(f.threshold)}`,
  },
  skill_not_taught: {
    label: 'Навыка нет в программах',
    pass: (f) => `Навык ${str(f.skillName)} не преподаёт ни одна из ${count(f.programs, ['действующей программы', 'действующих программ', 'действующих программ'])}`,
    fail: (f) =>
      num(f.programs) === 0
        ? 'Действующих программ нет — дефицит не с чем сравнить'
        : `Навык ${str(f.skillName)} уже есть в ${count(f.programsWithSkill, ['программе', 'программах', 'программах'])} — это неравномерное покрытие, а не дефицит`,
  },
  product_available: {
    label: 'Есть наш продукт',
    pass: (f) => `Навык даёт продукт: ${str(f.productNames)}`,
    fail: () => 'Ни один действующий IT-продукт не даёт этот навык',
  },
  gap_in_top: {
    label: 'В числе самых востребованных',
    pass: (f) => `${num(f.rank)}-й по спросу среди дефицитов, за раз показывается ${num(f.limit)}`,
    fail: (f) => `${num(f.rank)}-й по спросу среди дефицитов, а за раз показывается ${num(f.limit)} — ждёт очереди`,
  },
  rule_weight_low: {
    label: 'Вес правила',
    pass: (f) =>
      num(f.trialsEff) < 1 && f.pSource === 'global'
        ? `Вес правила ${share(f.p)}: решений по правилу «${str(f.ruleLabel)}» пока нет — оценка нейтральная`
        : `Вес правила ${share(f.p)}: по решениям сотрудников рекомендации «${str(f.ruleLabel)}» полезны примерно в ${percent(f.p)} случаев`,
    fail: (f) =>
      `Вес правила ${share(f.p)} ниже ${share(f.threshold)}: рекомендации «${str(f.ruleLabel)}» полезны лишь примерно в ${percent(f.p)} случаев — балл снижен`,
  },
  manager_overloaded: {
    label: 'Нагрузка менеджера',
    pass: (f) =>
      f.shown === undefined
        ? 'Нагрузка менеджера в норме'
        : `За ${days(f.windowDays)} менеджеру показано ${num(f.shown)}, выполнено ${num(f.done)} — нагрузка в норме`,
    fail: (f) =>
      `За ${days(f.windowDays)} менеджеру показано ${num(f.shown)}, выполнено ${num(f.done)} (меньше ${Math.round(num(f.maxDoneShare) * 100)} %) — ` +
      `рекомендация с баллом ниже ${share(f.threshold)} отложена`,
  },
}

/** Причина из словаря: текст — по коду, состоянию и фактам. */
export function reason(code: ReasonCode, pass: boolean, facts: Facts = {}): RecommendationReasonDto {
  const text = REASON_TEXTS[code]
  return { code, pass, label: text.label, detail: pass ? text.pass(facts) : text.fail(facts), facts }
}

/** Все проверки пройдены — правило выдаёт рекомендацию. */
export function allPass(reasons: ReadonlyArray<{ pass: boolean }>): boolean {
  return reasons.every((item) => item.pass)
}

/** Причины из базы (jsonb) — только корректные записи; повреждённое не ломает ленту. */
export function parseReasons(value: unknown): RecommendationReasonDto[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is RecommendationReasonDto =>
      item !== null &&
      typeof item === 'object' &&
      typeof (item as { code?: unknown }).code === 'string' &&
      typeof (item as { pass?: unknown }).pass === 'boolean' &&
      typeof (item as { detail?: unknown }).detail === 'string',
  )
}
