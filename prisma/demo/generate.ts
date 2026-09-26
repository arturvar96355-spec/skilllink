/**
 * Генератор расширенного демо-набора (решение 131): стенд должен выглядеть как
 * система после полугода работы — 19 вузов, ~50 связок на всех 14 этапах, история
 * этапов за девять месяцев, документы, встречи, заявки.
 *
 * Чистая функция: на входе якорная дата (момент заливки) и дата, до которой
 * стенд должен «не протухать»; на выходе — простые объекты без обращений к базе.
 * Один вход — один результат (ГПСЧ mulberry32, зерно — FNV-1a ключа объекта):
 * это проверяет тест, сравнивая хеши двух прогонов.
 *
 * Скрытые закономерности для аналитики — в каталоге (catalog.ts, `pattern`):
 * застревание на этапе 6, «уходящий» вуз, всплеск спроса на продукт за последнюю
 * неделю, сезонность встреч (январь и август тише).
 */

import { computeControlStatus } from '@/modules/workflow/workflow.rules'
import { ANONYMIZED_CONTACT_FIELDS } from '@/modules/universities/universities.rules'
import { WORKFLOW_STAGES } from '@/shared/config/workflow.config'
import type {
  ApplicationStatus,
  ConsentForm,
  ConsentStatus,
  ContactLegalBasis,
  CooperationStatus,
  DocumentStatus,
  DocumentType,
  MeetingFormat,
  ProductSkillRelevance,
  ProductStatus,
  ProgramLevel,
  ProgramStatus,
  RecommendationPriority,
  RecommendationStatus,
  RecommendationType,
  SkillImportance,
  SkillLevel,
  StagePhase,
  StageStatus,
  UniversityStatus,
} from '@/shared/contracts/enums'
import {
  COOPERATION_SPECS,
  EXTRA_MARKET,
  EXTRA_PRODUCTS,
  EXTRA_PROGRAMS,
  EXTRA_SKILLS,
  EXTRA_UNIVERSITIES,
  fillProgramSkills,
  MORE_SKILLS,
  REGIONAL_SOURCE,
  type CooperationPattern,
  type CooperationSpec,
  type ProgramSpec,
} from './catalog'
import { Rng, validInn, validOgrn } from './random'

export const DAY_MS = 24 * 60 * 60 * 1000

/**
 * До какого дня стенд не должен «протухать»: конец экспертизы 14.10.2026 плюс сутки
 * запаса, по Москве. Будущие даты (сроки, встречи, следующие шаги) сдвигаются за эту
 * границу — будущая встреча не станет прошедшей без итога, этап в срок не станет
 * просроченным. Прошедшие даты не сдвигаются: просроченное остаётся просроченным.
 * TEMP: для следующего показа — переменная SEED_STABLE_UNTIL (ISO-дата).
 */
export const DEFAULT_STABLE_UNTIL = new Date('2026-10-15T21:00:00.000Z')

/** Горизонт истории: связки начаты не раньше, чем ~9 месяцев назад. */
const MAX_HISTORY_DAYS = 262

/**
 * Медианы длительности этапов, дней (TEMP, только демо-набор). Логнормальное
 * распределение с sigma 0.45: обычно около медианы, изредка вдвое-втрое дольше.
 */
export const STAGE_MEDIAN_DAYS: Readonly<Record<number, number>> = {
  1: 4, 2: 5, 3: 6, 4: 10, 5: 9, 6: 10, 7: 9, 8: 10, 9: 11, 10: 11, 11: 22, 12: 24, 13: 25,
}
const STAGE_SIGMA = 0.45
/** Во сколько раз дольше идёт этап 6 у «застревающих» вузов. */
export const STUCK_FACTOR = 3.5

/** Сроки этапов после начала занятий, дней от него — как в основном сиде (решение 85). */
const DAYS_AFTER_CLASSES_START: Partial<Record<number, number>> = { 11: 30, 12: 60, 13: 90, 14: 120 }

// ─────────────────────────────── Типы результата ──────────────────────────────

export interface DemoOptions {
  /** Момент заливки: от него считаются все даты. */
  anchor: Date
  /** До какой даты будущее должно оставаться будущим. */
  stableUntil: Date
}

export interface DemoHistoryEntry {
  fromStatus: StageStatus | null
  toStatus: StageStatus
  changedAt: Date
  comment: string | null
}

export interface DemoTask {
  title: string
  isRequired: boolean
  isUniversityItem: boolean
  sortOrder: number
  isDone: boolean
  doneAt: Date | null
  confirmationNote: string | null
}

export interface DemoStage {
  number: number
  title: string
  phase: StagePhase
  status: StageStatus
  deadline: Date
  /** Вход в этап. У не начатого и у этапа 5, отменённого как ненужный, — null. */
  startedAt: Date | null
  completedAt: Date | null
  /** Выход из этапа: завершение или отмена вместе со связкой. */
  endedAt: Date | null
  result: string | null
  comment: string | null
  blockingReason: string | null
  tasks: DemoTask[]
  history: DemoHistoryEntry[]
}

export interface DemoDocumentStep {
  fromStatus: DocumentStatus
  toStatus: DocumentStatus
  changedAt: Date
  comment: string | null
}

export interface DemoDocument {
  key: string
  type: DocumentType
  title: string
  version: string
  status: DocumentStatus
  issuedAt: Date
  signedAt: Date | null
  createdAt: Date
  updatedAt: Date
  history: DemoDocumentStep[]
}

export type DemoParticipant =
  | { kind: 'responsible' }
  | { kind: 'colleague' }
  | { kind: 'contact'; contactKey: string }

export interface DemoMeeting {
  key: string
  date: Date
  topic: string
  format: MeetingFormat
  result: string | null
  nextAction: string | null
  nextActionDueAt: Date | null
  createdAt: Date
  participants: DemoParticipant[]
}

export interface DemoCooperation {
  key: string
  universityKey: string
  programKey: string
  productKey: string | null
  responsible: 'manager' | 'manager2'
  status: CooperationStatus
  pattern: CooperationPattern
  /** Этап, на котором связка (см. CooperationSpec.stage); 14 — все этапы пройдены. */
  currentStage: number
  /** Работа стоит между этапами: предыдущий закрыт, текущий не начат. */
  idle: boolean
  goal: string
  notes: string | null
  startedAt: Date
  firstContactAt: Date
  classesStartAt: Date | null
  targetDate: Date | null
  closedAt: Date | null
  stages: DemoStage[]
  documents: DemoDocument[]
  meetings: DemoMeeting[]
}

export interface DemoContact {
  key: string
  fullName: string
  position: string | null
  email: string | null
  phone: string | null
  isPrimary: boolean
  legalBasis: ContactLegalBasis | null
  consentStatus: ConsentStatus
  consentObtainedAt: Date | null
  consentForm: ConsentForm | null
  consentWithdrawnAt: Date | null
  basisReference: string | null
  withdrawalReference: string | null
  basisUpdatedAt: Date | null
  createdAt: Date
  updatedAt: Date
  history: Array<{
    fromBasis: ContactLegalBasis | null
    toBasis: ContactLegalBasis
    fromConsentStatus: ConsentStatus
    toConsentStatus: ConsentStatus
    consentObtainedAt: Date | null
    consentForm: ConsentForm | null
    consentWithdrawnAt: Date | null
    anonymized: boolean
    changedAt: Date
  }>
}

export interface DemoUniversity {
  key: string
  name: string
  shortName: string
  city: string
  region: string
  status: UniversityStatus
  directionCount: number
  studentCount: number
  createdAt: Date
  updatedAt: Date
  archivedAt: Date | null
  contacts: DemoContact[]
  /// ИНН/ОГРН с верной контрольной суммой (решение 134, решение 141) — prisma/demo/random.ts.
  inn: string
  ogrn: string
}

export interface DemoApplication {
  status: ApplicationStatus
  quantity: number
  submittedAt: Date
}

export interface DemoProgram {
  key: string
  universityKey: string
  name: string
  code: string | null
  direction: string | null
  level: ProgramLevel
  durationMonths: number
  status: ProgramStatus
  applicationCount: number | null
  studentCount: number | null
  groupCount: number | null
  metricsUpdatedAt: Date | null
  createdAt: Date
  archivedAt: Date | null
  skills: ReadonlyArray<readonly [string, SkillLevel, SkillImportance]>
  applications: DemoApplication[]
}

export interface DemoProduct {
  key: string
  name: string
  category: string
  description: string
  version: string | null
  status: ProductStatus
  createdAt: Date
  updatedAt: Date
  skills: ReadonlyArray<readonly [string, ProductSkillRelevance]>
}

export interface DemoMarketRow {
  skill: string
  period: string
  value: number
  region: string
  /** `base` — прежний демо-источник, `regional` — выгрузка по регионам. */
  source: 'base' | 'regional'
}

/** Закрытая рекомендация из прошлого: движок правил выдаёт только новые. */
export interface DemoResolvedRecommendation {
  key: string
  cooperationKey: string | null
  programKey: string | null
  objectType: 'Cooperation' | 'EducationalProgram'
  ruleKey: string
  type: RecommendationType
  priority: RecommendationPriority
  status: Extract<RecommendationStatus, 'DONE' | 'DISMISSED'>
  title: string
  description: string
  justification: string
  relatedData: Record<string, unknown>
  resolutionComment: string
  createdAt: Date
  resolvedAt: Date
}

/**
 * Встреча с вузом без связки: всплеск спроса на продукт — вузы просят показать его
 * после соревнований. Привязана к вузу, программы и связки у неё нет.
 */
export interface DemoUniversityMeeting {
  key: string
  universityKey: string
  responsible: 'manager' | 'manager2'
  date: Date
  topic: string
  format: MeetingFormat
  result: string
  nextAction: string
  nextActionDueAt: Date
  /** Основной контакт вуза расширенного набора; у вузов основного сида — берётся из базы. */
  contactKey: string | null
}

export interface DemoData {
  anchor: Date
  stableUntil: Date
  skills: typeof EXTRA_SKILLS
  market: DemoMarketRow[]
  products: DemoProduct[]
  universities: DemoUniversity[]
  programs: DemoProgram[]
  cooperations: DemoCooperation[]
  universityMeetings: DemoUniversityMeeting[]
  resolvedRecommendations: DemoResolvedRecommendation[]
}

/** Этап в истории связки — для таблицы истории этапов (решение 120). */
export interface StageTimelineEntry {
  stage: number
  enteredAt: Date
  leftAt: Date | null
}

// ─────────────────────────────── Даты ─────────────────────────────────────────

interface Clock {
  anchor: Date
  /** На сколько сдвигаются будущие даты, мс: до конца «окна стабильности». */
  shift: number
}

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS)
const minDate = (a: Date, b: Date) => (a < b ? a : b)
const maxDate = (a: Date, b: Date) => (a > b ? a : b)

/** Будущее — за окно стабильности; прошлое остаётся на месте. */
function stabilize(clock: Clock, date: Date): Date {
  return date > clock.anchor ? new Date(date.getTime() + clock.shift) : date
}

const isWeekend = (date: Date) => {
  const day = date.getUTCDay()
  return day === 0 || day === 6
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/** Рабочее время по Москве: 9:00–17:55 (UTC+3), минуты кратны пяти. */
function atWorkHour(day: Date, rng: Rng): Date {
  const minutes = 6 * 60 + rng.int(0, 107) * 5
  return new Date(startOfUtcDay(day).getTime() + minutes * 60 * 1000)
}

/** Ближайшее рабочее время не позже `date`: события не бывают в выходные и ночью. */
function workTimeBefore(date: Date, rng: Rng): Date {
  let result = atWorkHour(date, rng)
  if (result > date) result = atWorkHour(addDays(date, -1), rng)
  while (isWeekend(result)) result = atWorkHour(addDays(result, -1), rng)
  return result
}

/** Ближайшее рабочее время не раньше `date`. */
function workTimeAfter(date: Date, rng: Rng): Date {
  let result = atWorkHour(date, rng)
  if (result < date) result = atWorkHour(addDays(date, 1), rng)
  while (isWeekend(result)) result = atWorkHour(addDays(result, 1), rng)
  return result
}

const ddmm = (date: Date) =>
  `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}`

// ─────────────────────────────── Тексты ───────────────────────────────────────

const STAGE_RESULTS: Readonly<Record<number, readonly string[]>> = {
  1: ['Ответственный найден: заведующий кафедрой, рабочие контакты внесены', 'Контакт получен через центр карьеры вуза и подтверждён'],
  2: ['Кафедра подтвердила актуальность программы на следующий учебный год', 'Программа актуальна, согласован состав курса'],
  3: ['Встреча проведена, согласован план работ', 'Продукт показан кафедре, вуз готов к оформлению'],
  4: ['Пакет документов направлен, документы вуза получены', 'Документы вуза получены, замечаний нет'],
  5: ['Замечания сторон учтены во второй редакции', 'Исправленная редакция согласована сторонами'],
  6: ['Договор подписан обеими сторонами', 'Договор подписан, скан — в архиве договоров'],
  7: ['Материалы и лицензия переданы, вуз подтвердил получение', 'Лицензия активирована, материалы загружены в систему обучения вуза'],
  8: ['Продукт развёрнут в контуре вуза, проверка пройдена', 'Стенд развёрнут, доступы выданы кафедре'],
  9: ['Семинар для преподавателей проведён, выданы сертификаты', 'Преподаватели кафедры обучены работе с продуктом'],
  10: ['Изменения в программу утверждены учёным советом', 'Рабочая программа дисциплины обновлена и утверждена'],
  11: ['Занятия начались, численность и группы внесены', 'Курс стартовал по расписанию, группы сформированы'],
  12: ['Материалы обновлены до текущей версии продукта', 'Передана актуальная версия материалов'],
  13: ['Повышение квалификации проведено', 'Преподаватели прошли курс повышения квалификации'],
}

const BLOCK_EPISODES = [
  'Ждём ответ юридической службы вуза',
  'Нет доступа к серверной вуза до завершения проверки',
  'Сессия в вузе: встречи перенесены',
  'Ждём подписи проректора',
]

function confirmationNote(rng: Rng, date: Date): string {
  return rng.pick([
    `Подтверждено письмом вуза от ${ddmm(date)} (демонстрационные данные)`,
    'Подписан акт приёма-передачи материалов (демонстрационные данные)',
    `Подтверждено на встрече ${ddmm(date)}, есть протокол (демонстрационные данные)`,
  ])
}

// ─────────────────────────────── Связка ───────────────────────────────────────

interface CooperationContext {
  clock: Clock
  primaryContactOf: (universityKey: string) => string | null
  secondContactOf: (universityKey: string) => string | null
}

/** Дни, в которые приходит всплеск: рабочие дни среди последних шести полных. */
function recentWorkdays(anchor: Date): Date[] {
  const today = startOfUtcDay(anchor)
  const days: Date[] = []
  for (let back = 1; back <= 6; back += 1) {
    const day = addDays(today, -back)
    if (!isWeekend(day)) days.push(day)
  }
  return days
}

function generateCooperation(spec: CooperationSpec, context: CooperationContext): DemoCooperation {
  const { clock } = context
  const { anchor } = clock
  const rng = new Rng(`cooperation:${spec.key}`)

  const current = spec.stage
  const allDone = current === 14
  const cancelled = spec.status === 'CANCELLED'
  const idle = spec.idle === true || spec.status === 'PAUSED'
  const lastDone = allDone ? 13 : current - 1
  // Этап 5 «при необходимости»: у части связок отменён как ненужный.
  const skip5 = lastDone >= 5 && current !== 5 && rng.chance(0.4)

  const factorOf = (stage: number) =>
    spec.pattern === 'stuck' && stage === 6 ? STUCK_FACTOR * Math.exp(0.12 * rng.normal()) : 1

  // ── Длительности пройденных этапов ──
  const durations = new Map<number, number>()
  for (let stage = 1; stage <= lastDone; stage += 1) {
    if (stage === 5 && skip5) continue
    const median = STAGE_MEDIAN_DAYS[stage]! * factorOf(stage)
    durations.set(stage, Math.min(Math.max(rng.lognormal(median, STAGE_SIGMA), 0.6), median * 4))
  }

  // ── Хвост: сколько времени от конца цепочки до сегодня ──
  let tail: number
  let workInCancelled = 0
  if (allDone) tail = rng.uniform(20, 90)
  else if (idle) tail = spec.pattern === 'fading' ? rng.uniform(50, 70) : rng.uniform(25, 45)
  else if (cancelled) {
    const closedAgo = rng.uniform(20, 110)
    workInCancelled = Math.max(2, rng.lognormal(STAGE_MEDIAN_DAYS[current]! * factorOf(current), STAGE_SIGMA))
    tail = closedAgo + workInCancelled
  } else if (spec.pattern === 'stuck' && current === 6) tail = rng.uniform(55, 85)
  else if (spec.pattern === 'fading') tail = rng.uniform(55, 75)
  else if (spec.pattern === 'demandBase') tail = rng.uniform(10, 28)
  else if (spec.overdue) tail = rng.uniform(25, 45)
  else if (spec.blocked) tail = rng.uniform(14, 32)
  else tail = Math.max(1.5, rng.uniform(0.2, 0.85) * STAGE_MEDIAN_DAYS[current]!)

  // Не глубже девяти месяцев: длинную цепочку сжимаем пропорционально.
  const total = [...durations.values()].reduce((sum, value) => sum + value, 0)
  if (total + tail > MAX_HISTORY_DAYS) {
    const scale = (MAX_HISTORY_DAYS - tail) / total
    for (const [stage, value] of durations) durations.set(stage, Math.max(0.6, value * scale))
  }

  // ── Цепочка этапов: от конца к началу ──
  const enter = new Map<number, Date>()
  const leave = new Map<number, Date>()
  let chainEnd: Date
  if (spec.pattern === 'spike') {
    // Всплеск: заявка пришла в последние дни, первые этапы проходят за день-два.
    // Дни — рабочие среди последних шести полных (recentWorkdays, от вчера назад).
    const days = recentWorkdays(anchor)
    const older = rng.int(1, days.length - 1)
    if (current === 2) {
      enter.set(1, atWorkHour(days[older]!, rng))
      leave.set(1, atWorkHour(days[rng.int(0, older - 1)]!, rng))
      chainEnd = leave.get(1)!
    } else {
      chainEnd = atWorkHour(days[older]!, rng)
    }
  } else {
    chainEnd = workTimeBefore(addDays(anchor, -tail), rng)
    let cursor = chainEnd
    for (let stage = lastDone; stage >= 1; stage -= 1) {
      const duration = durations.get(stage)
      if (duration === undefined) continue
      leave.set(stage, cursor)
      let entered = workTimeBefore(addDays(cursor, -duration), rng)
      if (entered >= cursor) entered = new Date(cursor.getTime() - 3 * 60 * 60 * 1000)
      enter.set(stage, entered)
      cursor = entered
    }
  }
  const startedAt = enter.get(1) ?? chainEnd
  if (!allDone && !idle) enter.set(current, chainEnd)

  let cancelledAt: Date | null = null
  if (cancelled) {
    cancelledAt = minDate(workTimeAfter(addDays(chainEnd, workInCancelled), rng), addDays(anchor, -1))
  }
  const lastLeave = allDone ? leave.get(13)! : null
  let closedAt: Date | null = cancelledAt
  if (allDone && spec.status === 'COMPLETED') {
    closedAt = minDate(workTimeAfter(addDays(lastLeave!, rng.uniform(1, 4)), rng), addDays(anchor, -1))
  }

  // ── Статусы этапов ──
  const statusOf = (stage: number): StageStatus => {
    if (stage <= lastDone) return stage === 5 && skip5 ? 'CANCELLED' : 'COMPLETED'
    if (stage === current && !idle && !allDone) {
      if (cancelled) return 'CANCELLED'
      if (spec.blocked) return 'BLOCKED'
      return 'IN_PROGRESS'
    }
    return 'NOT_STARTED'
  }
  const statuses = new Map<number, StageStatus>()
  for (let stage = 1; stage <= 13; stage += 1) statuses.set(stage, statusOf(stage))
  statuses.set(14, computeControlStatus([...statuses.values()]))

  // ── Начало занятий ──
  //
  // Плановая дата раньше снималась на ближайшую границу семестра (1 сентября/
  // 9 февраля) — настоящую календарную дату, которая не сдвигается вместе
  // с anchor. А firstContactAt anchor-относителен («N дней назад» растёт с каждым
  // днём), и разрыв между ними «плыл» на день-два при каждой перезаливке в другой
  // день — отсюда «дней до начала занятий» и доля этапов 11–14 «в срок» (их дедлайн
  // считается от classesStartAt) не совпадали между прогонами (решение 141, замечание
  // владельца). Теперь дата — фиксированный anchor-относительный отступ, как и
  // остальные плановые сроки набора: перезаливка в другой день даёт для той же
  // связки то же число дней до занятий, до 14.10 и позже.
  const open = spec.status === 'ACTIVE' || spec.status === 'DRAFT' || spec.status === 'PAUSED'
  let classesStartAt: Date | null = enter.get(11) ?? null
  if (!classesStartAt && open && current >= 4) {
    const classesRng = new Rng(`classes-start:${spec.key}`)
    classesStartAt = addDays(maxDate(addDays(startedAt, 150), addDays(anchor, 30)), classesRng.int(0, 45))
  }

  // ── Сроки ──
  const deadlines = new Map<number, Date>()
  for (const definition of WORKFLOW_STAGES) {
    const stage = definition.number
    let raw = addDays(startedAt, definition.normativeDays)
    const afterClasses = DAYS_AFTER_CLASSES_START[stage]
    if (classesStartAt && afterClasses !== undefined) raw = maxDate(raw, addDays(classesStartAt, afterClasses))
    const status = statuses.get(stage)!
    const isCurrentOpen = open && stage === current && (status === 'IN_PROGRESS' || status === 'BLOCKED')
    if (isCurrentOpen && spec.overdue) {
      raw = maxDate(addDays(anchor, -rng.uniform(2, 6)), addDays(enter.get(stage)!, 1))
    } else if (isCurrentOpen && raw <= addDays(anchor, 1)) {
      // Срок уже вышел, а просрочки по сюжету нет: срок перенесли по согласованию с вузом.
      raw = addDays(anchor, rng.uniform(7, 40))
    } else if (stage === 14 && open && status !== 'COMPLETED' && raw <= anchor) {
      raw = addDays(anchor, rng.uniform(30, 90))
    }
    deadlines.set(stage, stabilize(clock, raw))
  }

  // ── Этапы: даты, пункты, история ──
  const stages: DemoStage[] = WORKFLOW_STAGES.map((definition) => {
    const stage = definition.number
    const status = statuses.get(stage)!
    const stageRng = new Rng(`stage:${spec.key}:${stage}`)
    const isControl = stage === 14
    let startedAtStage: Date | null = enter.get(stage) ?? null
    let completedAt: Date | null = status === 'COMPLETED' ? (leave.get(stage) ?? null) : null
    let endedAt: Date | null = completedAt
    if (isControl) {
      startedAtStage = status === 'NOT_STARTED' ? null : startedAt
      completedAt = status === 'COMPLETED' ? lastLeave : null
      endedAt = completedAt
    }
    if (status === 'CANCELLED' && stage === current) endedAt = cancelledAt
    if (status === 'CANCELLED' && stage === 5 && skip5) startedAtStage = null

    const history: DemoHistoryEntry[] = []
    if (isControl) {
      if (status !== 'NOT_STARTED') history.push({ fromStatus: 'NOT_STARTED', toStatus: 'IN_PROGRESS', changedAt: startedAt, comment: null })
      if (status === 'COMPLETED') history.push({ fromStatus: 'IN_PROGRESS', toStatus: 'COMPLETED', changedAt: completedAt!, comment: 'Все этапы закрыты' })
    } else if (status === 'CANCELLED' && stage === 5 && skip5) {
      history.push({
        fromStatus: 'NOT_STARTED', toStatus: 'CANCELLED',
        // Тем же моментом, что закрыт этап 4: текущим этап 5 не становился ни на час
        // (хронология аналитики этапов, решение 120, иначе дала бы ему «длительность»).
        changedAt: leave.get(4)!,
        comment: 'Не требуется: замечаний к документам нет',
      })
    } else if (startedAtStage) {
      history.push({ fromStatus: 'NOT_STARTED', toStatus: 'IN_PROGRESS', changedAt: startedAtStage, comment: null })
      if (status === 'COMPLETED') {
        const span = completedAt!.getTime() - startedAtStage.getTime()
        if ([4, 6, 7, 9, 10].includes(stage) && span > 4 * DAY_MS && stageRng.chance(0.15)) {
          const blockedAt = new Date(startedAtStage.getTime() + span * stageRng.uniform(0.2, 0.4))
          const unblockedAt = new Date(startedAtStage.getTime() + span * stageRng.uniform(0.55, 0.8))
          history.push({ fromStatus: 'IN_PROGRESS', toStatus: 'BLOCKED', changedAt: blockedAt, comment: stageRng.pick(BLOCK_EPISODES) })
          history.push({ fromStatus: 'BLOCKED', toStatus: 'IN_PROGRESS', changedAt: unblockedAt, comment: 'Блокировка снята' })
        }
        history.push({ fromStatus: 'IN_PROGRESS', toStatus: 'COMPLETED', changedAt: completedAt!, comment: null })
      } else if (status === 'BLOCKED') {
        const earliest = startedAtStage.getTime() + DAY_MS
        const blockedAt = new Date(Math.max(earliest, addDays(anchor, -stageRng.uniform(15, 24)).getTime()))
        history.push({ fromStatus: 'IN_PROGRESS', toStatus: 'BLOCKED', changedAt: minDate(blockedAt, addDays(anchor, -1)), comment: spec.blocked ?? null })
      } else if (status === 'CANCELLED') {
        history.push({ fromStatus: 'IN_PROGRESS', toStatus: 'CANCELLED', changedAt: cancelledAt!, comment: spec.notes ?? 'Связка отменена' })
      }
    }

    // Пункты чек-листа.
    const tasks: DemoTask[] = definition.tasks.map((task, index) => ({
      title: task.title,
      isRequired: task.isRequired,
      isUniversityItem: task.universityItem === true,
      sortOrder: index,
      isDone: false,
      doneAt: null,
      confirmationNote: null,
    }))
    if (status === 'COMPLETED' && completedAt && startedAtStage) {
      for (const task of tasks) {
        if (!task.isRequired && stageRng.chance(0.2)) continue
        const span = completedAt.getTime() - startedAtStage.getTime()
        task.isDone = true
        task.doneAt = new Date(completedAt.getTime() - span * stageRng.uniform(0, 0.3))
        if (task.isUniversityItem) task.confirmationNote = confirmationNote(stageRng, task.doneAt)
      }
    } else if ((status === 'IN_PROGRESS' || status === 'BLOCKED') && startedAtStage) {
      const recent = spec.pattern === 'regular' || spec.pattern === 'spike' || spec.pattern === 'demandBase'
      const markable = definition.tasks
        .map((task, index) => ({ task, index }))
        .filter(({ task }) => !task.closedBySignedDocuments)
      for (const { task, index } of markable) {
        const target = tasks[index]!
        const isLastMarkable = index === markable[markable.length - 1]?.index
        if (isLastMarkable && markable.length > 1) continue // этап открыт: последний пункт ещё впереди
        if (!stageRng.chance(task.universityItem ? 0.35 : 0.6)) continue
        const from = startedAtStage.getTime()
        const until = recent ? anchor.getTime() - DAY_MS / 2 : Math.min(anchor.getTime(), from + 5 * DAY_MS)
        if (until <= from) continue
        target.isDone = true
        target.doneAt = new Date(from + (until - from) * stageRng.uniform(recent ? 0.6 : 0.1, recent ? 1 : 0.9))
        if (target.isUniversityItem) target.confirmationNote = confirmationNote(stageRng, target.doneAt)
      }
    }

    return {
      number: stage,
      title: definition.title,
      phase: definition.phase,
      status,
      deadline: deadlines.get(stage)!,
      startedAt: startedAtStage,
      completedAt,
      endedAt,
      result: status === 'COMPLETED' && !isControl ? stageRng.pick(STAGE_RESULTS[stage]!) : null,
      comment:
        status === 'CANCELLED'
          ? stage === 5 && skip5
            ? 'Не требуется: замечаний к документам нет'
            : (spec.notes ?? 'Связка отменена')
          : null,
      blockingReason: status === 'BLOCKED' ? (spec.blocked ?? null) : null,
      tasks,
      history,
    }
  })

  const cooperation: DemoCooperation = {
    key: spec.key,
    universityKey: spec.university,
    programKey: spec.program,
    productKey: spec.product,
    responsible: spec.responsible,
    status: spec.status,
    pattern: spec.pattern,
    currentStage: current,
    idle,
    goal: spec.goal,
    notes: spec.notes ?? null,
    startedAt,
    firstContactAt: startedAt,
    classesStartAt,
    targetDate: classesStartAt,
    closedAt,
    stages,
    documents: [],
    meetings: [],
  }
  cooperation.documents = generateDocuments(cooperation, spec, clock)
  cooperation.meetings = generateMeetings(cooperation, spec, context)
  return cooperation
}

// ─────────────────────────────── Документы ────────────────────────────────────

function generateDocuments(coop: DemoCooperation, spec: CooperationSpec, clock: Clock): DemoDocument[] {
  const rng = new Rng(`documents:${coop.key}`)
  const { anchor } = clock
  const entered = (stage: number) => coop.stages[stage - 1]?.startedAt ?? null
  const done = (stage: number) => coop.stages[stage - 1]?.completedAt ?? null
  const documents: DemoDocument[] = []
  const latest = addDays(anchor, -0.2)

  /** Документ с историей: путь статусов, шаги равномерно между выпуском и концом. */
  const add = (
    type: DocumentType,
    title: string,
    version: string,
    issuedAt: Date,
    path: DocumentStatus[],
    endAt: Date,
    comments: Partial<Record<DocumentStatus, string>> = {},
  ) => {
    const issued = minDate(issuedAt, latest)
    const end = minDate(maxDate(endAt, new Date(issued.getTime() + 60 * 60 * 1000)), latest)
    const history: DemoDocumentStep[] = []
    let previous: DocumentStatus = 'DRAFT'
    path.forEach((status, index) => {
      const share = (index + 1) / path.length
      const changedAt = new Date(issued.getTime() + (end.getTime() - issued.getTime()) * share)
      history.push({ fromStatus: previous, toStatus: status, changedAt, comment: comments[status] ?? null })
      previous = status
    })
    const status = path.length > 0 ? path[path.length - 1]! : 'DRAFT'
    documents.push({
      key: `${coop.key}:${documents.length}:${type}:${version}`,
      type, title, version, status,
      issuedAt: issued,
      signedAt: status === 'SIGNED' ? history[history.length - 1]!.changedAt : null,
      createdAt: issued,
      updatedAt: history.length > 0 ? history[history.length - 1]!.changedAt : issued,
      history,
    })
  }

  // Соглашение о неразглашении — к первой встрече.
  const e3 = entered(3)
  if (e3) {
    const signedAt = done(4)
    if (signedAt) add('NDA', 'Соглашение о неразглашении', '1', addDays(e3, 1), ['REVIEW', 'APPROVED', 'SIGNED'], addDays(signedAt, -1))
    else add('NDA', 'Соглашение о неразглашении', '1', addDays(e3, 1), entered(4) ? ['REVIEW', 'APPROVED'] : ['REVIEW'], minDate(addDays(e3, 3), latest))
  }

  // Договор: у «застревающих» — несколько редакций, отклонённые и заменённые.
  const e4 = entered(4)
  if (e4) {
    const signed = done(6)
    const e6 = entered(6)
    const stuck = spec.pattern === 'stuck'
    let version = 1
    let issued = addDays(e4, 2)
    if (e6 && stuck) {
      const until = signed ?? coop.stages[5]?.endedAt ?? latest
      const span = until.getTime() - e6.getTime()
      const rounds = rng.int(1, 2)
      for (let round = 0; round < rounds; round += 1) {
        const end = new Date(e6.getTime() + span * ((round + 1) / (rounds + 2)))
        const rejected = round === 0
        add(
          'AGREEMENT', 'Договор о сотрудничестве', String(version), issued,
          rejected ? ['REVIEW', 'REJECTED'] : ['REVIEW', 'ARCHIVED'], end,
          rejected
            ? { REJECTED: 'Юридическая служба вуза не согласовала пункт о правах на материалы' }
            : { ARCHIVED: 'Заменена следующей редакцией' },
        )
        version += 1
        issued = addDays(end, 1)
      }
    }
    if (signed) {
      add('AGREEMENT', 'Договор о сотрудничестве', String(version), issued, ['REVIEW', 'APPROVED', 'SIGNED'], addDays(signed, -0.1))
    } else if (coop.status === 'CANCELLED' && coop.currentStage === 6) {
      add('AGREEMENT', 'Договор о сотрудничестве', String(version), issued, ['REVIEW', 'REJECTED'], coop.closedAt ?? latest,
        { REJECTED: 'Вуз не принял условия договора' })
    } else if (e6) {
      add('AGREEMENT', 'Договор о сотрудничестве', String(version), issued, stuck ? ['REVIEW'] : ['REVIEW', 'APPROVED'], minDate(addDays(e6, 5), latest))
    } else {
      add('AGREEMENT', 'Договор о сотрудничестве', String(version), issued, rng.chance(0.5) ? ['REVIEW'] : [], minDate(addDays(issued, 4), latest))
    }
  }

  // Приложение с перечнем материалов — когда была доработка документов (этап 5).
  const s5 = coop.stages[4]
  if (s5?.status === 'COMPLETED' && s5.startedAt) {
    const signed = done(6)
    add('ANNEX', 'Приложение: перечень передаваемых материалов', '1', s5.startedAt,
      signed ? ['REVIEW', 'APPROVED', 'SIGNED'] : ['REVIEW', 'APPROVED'], signed ? addDays(signed, -0.1) : s5.completedAt!)
  }

  // Лицензия — на этапе 7.
  const e7 = entered(7)
  if (e7 && coop.productKey) {
    const signed = done(7)
    add('LICENSE', 'Лицензия на IT-продукт', '1', addDays(e7, 0.5), signed ? ['REVIEW', 'APPROVED', 'SIGNED'] : ['REVIEW', 'APPROVED'],
      signed ? addDays(signed, -1) : minDate(addDays(e7, 3), latest))
  }

  // Методические материалы — к обучению преподавателей.
  const e9 = entered(9)
  if (e9) {
    add('METHODOLOGY', 'Методические рекомендации по курсу', '1', addDays(e9, 1), done(9) ? ['REVIEW', 'APPROVED'] : [],
      done(9) ?? minDate(addDays(e9, 2), latest))
  }

  // Изменения учебного плана.
  const e10 = entered(10)
  if (e10) {
    add('CURRICULUM', 'Изменения в учебный план', '1', addDays(e10, 1), done(10) ? ['REVIEW', 'APPROVED'] : ['REVIEW'],
      done(10) ?? minDate(addDays(e10, 4), latest))
  }

  // Акты — начало занятий и итог сотрудничества.
  const d11 = done(11)
  if (d11) add('ACT', 'Акт о начале занятий', '1', addDays(d11, -2), ['REVIEW', 'APPROVED', 'SIGNED'], d11)
  const d13 = done(13)
  if (d13) add('ACT', 'Акт об итогах сотрудничества', '1', addDays(d13, -3), ['REVIEW', 'APPROVED', 'SIGNED'], d13)

  return documents
}

// ─────────────────────────────── Встречи ──────────────────────────────────────

/**
 * Сезонность: в январе (каникулы) и августе (отпуска) встреч меньше. Необязательные
 * встречи в эти месяцы остаются с вероятностью 0,3.
 */
export function seasonalKeep(date: Date): number {
  const month = date.getUTCMonth()
  return month === 0 || month === 7 ? 0.3 : 1
}

function generateMeetings(coop: DemoCooperation, spec: CooperationSpec, context: CooperationContext): DemoMeeting[] {
  const { clock } = context
  const { anchor } = clock
  const rng = new Rng(`meetings:${coop.key}`)
  const primary = context.primaryContactOf(coop.universityKey)
  const second = context.secondContactOf(coop.universityKey)
  const meetings: DemoMeeting[] = []
  const entered = (stage: number) => coop.stages[stage - 1]?.startedAt ?? null
  const done = (stage: number) => coop.stages[stage - 1]?.completedAt ?? null

  /** Последняя активность связки: после неё у «уходящего» вуза встреч нет. */
  const lastActivity = coop.stages
    .flatMap((stage) => [...stage.history.map((entry) => entry.changedAt), ...stage.tasks.flatMap((task) => (task.doneAt ? [task.doneAt] : []))])
    .reduce((latest, date) => (date > latest ? date : latest), coop.startedAt)
  const pastLimit = coop.closedAt ?? (coop.pattern === 'fading' ? lastActivity : addDays(anchor, -0.25))

  const participants = (withSecond: boolean): DemoParticipant[] => [
    { kind: 'responsible' },
    ...(rng.chance(0.2) ? [{ kind: 'colleague' } as const] : []),
    ...(primary ? [{ kind: 'contact', contactKey: primary } as const] : []),
    ...(withSecond && second ? [{ kind: 'contact', contactKey: second } as const] : []),
  ]

  const push = (
    date: Date,
    topic: string,
    format: MeetingFormat,
    result: string,
    options: { key: boolean; withSecond?: boolean; nextAction?: string },
  ) => {
    if (date < coop.startedAt || date > pastLimit) return
    if (!options.key && !rng.chance(seasonalKeep(date))) return
    const nextActionDueAt = options.nextAction ? stabilize(clock, addDays(date, rng.int(7, 21))) : null
    meetings.push({
      key: `${coop.key}:${meetings.length}`,
      date,
      topic,
      format,
      result,
      nextAction: options.nextAction ?? null,
      nextActionDueAt,
      createdAt: date,
      participants: participants(options.withSecond === true),
    })
  }
  const meetingTime = (from: Date, to: Date) => {
    const raw = new Date(from.getTime() + (to.getTime() - from.getTime()) * rng.uniform(0.15, 0.85))
    return workTimeBefore(raw, rng)
  }

  // Первый созвон — на этапе 2 (у заявок последних дней — сразу после неё).
  const e2 = entered(2) ?? (coop.pattern === 'spike' ? entered(1) : null)
  if (e2) {
    const until = done(2) ?? minDate(addDays(e2, 3), pastLimit)
    push(coop.pattern === 'spike' ? new Date(e2.getTime() + 2 * 60 * 60 * 1000) : meetingTime(e2, until),
      'Первый созвон: знакомство и актуальность программ', 'CALL',
      'Кафедра заинтересована, договорились о встрече', { key: true, nextAction: done(2) ? undefined : 'Назначить встречу на кафедре' })
  }
  // Заявка последних дней: следом за созвоном — показ продукта команде вуза.
  if (coop.pattern === 'spike') {
    const days = recentWorkdays(anchor).filter((day) => day.getTime() + DAY_MS > coop.startedAt.getTime())
    const day = days.length > 0 ? rng.pick(days) : startOfUtcDay(coop.startedAt)
    const date = maxDate(atWorkHour(day, rng), new Date(coop.startedAt.getTime() + 3 * 60 * 60 * 1000))
    push(date, 'Демонстрация продукта команде вуза', 'ONLINE', 'Показали сценарии, вуз собирает команду', { key: true })
  }
  // Встреча этапа 3 — ключевая: без неё этап не закрыть.
  const d3 = done(3)
  if (d3) {
    push(workTimeBefore(addDays(d3, -rng.uniform(0.2, 2)), rng), 'Встреча на кафедре: презентация продукта', rng.pick(['OFFLINE', 'ONLINE'] as const),
      'Продукт показан, вуз готов к оформлению документов', { key: true })
  }
  // Согласование документов (этапы 4–6): звонки и переписка, у «застревающих» — чаще.
  const e4 = entered(4)
  if (e4) {
    const until = done(6) ?? coop.stages[5]?.endedAt ?? (coop.currentStage >= 4 ? pastLimit : done(4) ?? pastLimit)
    const count = spec.pattern === 'stuck' ? rng.int(3, 5) : rng.int(1, 2)
    for (let index = 0; index < count; index += 1) {
      const format = rng.pick(['CALL', 'CORRESPONDENCE', 'ONLINE'] as const)
      push(meetingTime(e4, until), spec.pattern === 'stuck' ? 'Согласование договора с юридической службой вуза' : 'Согласование условий договора',
        format, spec.pattern === 'stuck' ? 'Вуз прислал замечания к редакции договора' : 'Условия согласованы, готовим подписание',
        { key: false, withSecond: spec.pattern === 'stuck' })
    }
  }
  // Передача материалов.
  const d7 = done(7)
  if (d7) push(workTimeBefore(addDays(d7, -rng.uniform(0.5, 3)), rng), 'Передача учебных материалов и лицензии', 'OFFLINE', 'Материалы и лицензия переданы', { key: true })
  // Проверка развёртывания.
  const e8 = entered(8)
  if (e8) push(meetingTime(e8, done(8) ?? pastLimit), 'Проверка развёртывания продукта', 'ONLINE', 'Стенд работает, замечания зафиксированы', { key: false })
  // Семинар для преподавателей.
  const e9 = entered(9)
  if (e9) push(meetingTime(e9, done(9) ?? pastLimit), 'Семинар для преподавателей', 'OFFLINE', 'Преподаватели прошли вводный семинар', { key: false })
  // Старт занятий и дальше — встречи раз в месяц-полтора.
  const e11 = entered(11)
  if (e11) {
    let cursor = addDays(e11, rng.uniform(3, 10))
    while (cursor < pastLimit) {
      push(workTimeBefore(cursor, rng), 'Промежуточные итоги курса', rng.pick(['ONLINE', 'CALL'] as const),
        'Курс идёт по плану, собрана обратная связь студентов', { key: false })
      cursor = addDays(cursor, rng.uniform(28, 45))
    }
  }
  // Рабочие созвоны по ходу связки — раз в 3–6 недель, с сезонностью.
  let cursor = addDays(coop.startedAt, rng.uniform(20, 40))
  const routineEnd = e11 ?? pastLimit
  while (cursor < routineEnd) {
    push(workTimeBefore(cursor, rng), 'Рабочий созвон по связке', rng.pick(['CALL', 'ONLINE', 'CORRESPONDENCE'] as const),
      'Сверили статус этапов и следующие шаги', { key: false })
    cursor = addDays(cursor, rng.uniform(21, 42))
  }
  // Закрытие — письмом (заочно).
  if (coop.status === 'CANCELLED' && coop.closedAt) {
    push(workTimeBefore(addDays(coop.closedAt, -1), rng), 'Письмо вуза о прекращении переговоров', 'CORRESPONDENCE',
      coop.notes ?? 'Вуз прекратил переговоры', { key: true })
  }
  if (coop.status === 'PAUSED') {
    const pausedAt = maxDate(coop.startedAt, addDays(anchor, -rng.uniform(10, 20)))
    push(workTimeBefore(pausedAt, rng), 'Письмо вуза о паузе в переговорах', 'CORRESPONDENCE', coop.notes ?? 'Вуз попросил паузу', { key: true })
  }

  // Будущие встречи — за окном стабильности: до конца экспертизы они не «протухнут».
  const futureAllowed = (coop.status === 'ACTIVE' || coop.status === 'DRAFT' || coop.status === 'PAUSED') && coop.pattern !== 'fading'
  if (futureAllowed && (coop.status === 'PAUSED' || coop.pattern === 'spike' || rng.chance(0.55))) {
    const date = workTimeAfter(stabilize(clock, addDays(anchor, rng.uniform(1, 30))), rng)
    const topic =
      coop.status === 'PAUSED' ? 'Возврат к переговорам после паузы'
        : coop.currentStage <= 3 ? 'Встреча на кафедре: презентация продукта'
          : coop.currentStage <= 6 ? 'Согласование и подписание договора'
            : coop.currentStage <= 10 ? 'Статус внедрения продукта'
              : 'Итоги семестра и планы на следующий'
    meetings.push({
      key: `${coop.key}:${meetings.length}`,
      date,
      topic,
      format: rng.pick(['ONLINE', 'OFFLINE', 'CALL'] as const),
      result: null,
      nextAction: null,
      nextActionDueAt: null,
      createdAt: minDate(addDays(anchor, -rng.uniform(0.5, 6)), anchor),
      participants: participants(false),
    })
  }

  meetings.sort((a, b) => a.date.getTime() - b.date.getTime())
  return meetings.map((meeting, index) => ({ ...meeting, key: `${coop.key}:${index}` }))
}

// ─────────────────────────────── Вузы и программы ─────────────────────────────

function generateUniversities(clock: Clock, earliestStart: Map<string, Date>): DemoUniversity[] {
  const { anchor } = clock
  let phone = 11
  return EXTRA_UNIVERSITIES.map((spec) => {
    const rng = new Rng(`university:${spec.key}`)
    const firstCoop = earliestStart.get(spec.key)
    let createdAt = workTimeBefore(addDays(anchor, -spec.createdDaysAgo), rng)
    if (firstCoop && createdAt > addDays(firstCoop, -7)) createdAt = workTimeBefore(addDays(firstCoop, -7), rng)
    const archivedAt = spec.archivedDaysAgo !== undefined ? workTimeBefore(addDays(anchor, -spec.archivedDaysAgo), rng) : null
    const updatedAt = archivedAt ?? maxDate(createdAt, workTimeBefore(addDays(anchor, -rng.uniform(3, 40)), rng))

    const contacts = spec.contacts.map((contact, index): DemoContact => {
      const key = `${spec.key}-${index}`
      const base = {
        key,
        createdAt,
        updatedAt: createdAt,
        consentWithdrawnAt: null,
        withdrawalReference: null,
      }
      const person = {
        fullName: contact.fullName,
        position: contact.position,
        email: `${contact.mailbox}@${spec.key}.example.invalid`,
        phone: `+7 900 000-00-${String(phone++).padStart(2, '0')}`,
        isPrimary: contact.isPrimary,
      }
      switch (contact.basis.kind) {
        case 'LEGITIMATE_INTEREST':
          return {
            ...base, ...person,
            legalBasis: 'LEGITIMATE_INTEREST', consentStatus: 'NONE', consentObtainedAt: null, consentForm: null,
            basisReference: contact.basis.reference, basisUpdatedAt: createdAt,
            history: [{ fromBasis: null, toBasis: 'LEGITIMATE_INTEREST', fromConsentStatus: 'NONE', toConsentStatus: 'NONE', consentObtainedAt: null, consentForm: null, consentWithdrawnAt: null, anonymized: false, changedAt: createdAt }],
          }
        case 'CONSENT':
          return {
            ...base, ...person,
            legalBasis: 'CONSENT', consentStatus: 'OBTAINED', consentObtainedAt: createdAt, consentForm: contact.basis.form,
            basisReference: contact.basis.reference, basisUpdatedAt: createdAt,
            history: [{ fromBasis: null, toBasis: 'CONSENT', fromConsentStatus: 'NONE', toConsentStatus: 'OBTAINED', consentObtainedAt: createdAt, consentForm: contact.basis.form, consentWithdrawnAt: null, anonymized: false, changedAt: createdAt }],
          }
        case 'WITHDRAWN': {
          // Отзыв согласия — контакт обезличен тем же набором полей, что в приложении.
          const withdrawnAt = workTimeBefore(addDays(anchor, -contact.basis.withdrawnDaysAgo), rng)
          phone -= 1
          return {
            ...base,
            fullName: ANONYMIZED_CONTACT_FIELDS.fullName,
            position: ANONYMIZED_CONTACT_FIELDS.position,
            email: ANONYMIZED_CONTACT_FIELDS.email,
            phone: ANONYMIZED_CONTACT_FIELDS.phone,
            isPrimary: ANONYMIZED_CONTACT_FIELDS.isPrimary,
            legalBasis: 'CONSENT', consentStatus: 'WITHDRAWN', consentObtainedAt: createdAt, consentForm: contact.basis.form,
            consentWithdrawnAt: withdrawnAt, basisReference: contact.basis.reference,
            withdrawalReference: contact.basis.withdrawalReference, basisUpdatedAt: withdrawnAt, updatedAt: withdrawnAt,
            history: [
              { fromBasis: null, toBasis: 'CONSENT', fromConsentStatus: 'NONE', toConsentStatus: 'OBTAINED', consentObtainedAt: createdAt, consentForm: contact.basis.form, consentWithdrawnAt: null, anonymized: false, changedAt: createdAt },
              { fromBasis: 'CONSENT', toBasis: 'CONSENT', fromConsentStatus: 'OBTAINED', toConsentStatus: 'WITHDRAWN', consentObtainedAt: createdAt, consentForm: contact.basis.form, consentWithdrawnAt: withdrawnAt, anonymized: true, changedAt: withdrawnAt },
            ],
          }
        }
        case 'NONE':
          return {
            ...base, ...person,
            legalBasis: null, consentStatus: 'NONE', consentObtainedAt: null, consentForm: null,
            basisReference: null, basisUpdatedAt: null, history: [],
          }
      }
    })

    return {
      key: spec.key,
      name: spec.name,
      shortName: spec.shortName,
      city: spec.city,
      region: spec.region,
      status: spec.status,
      directionCount: spec.directionCount,
      studentCount: spec.studentCount,
      createdAt,
      updatedAt,
      archivedAt,
      contacts,
      inn: validInn(spec.key),
      ogrn: validOgrn(spec.key),
    }
  })
}

/**
 * Заявки на обучение: сумма действующих (новые, подтверждённые, зачисленные) равна
 * показателю программы (решение 9). Приходят в приёмную кампанию — июнь–август.
 */
function generateApplications(spec: ProgramSpec, clock: Clock): DemoApplication[] {
  if (spec.applicationCount === null) return []
  const rng = new Rng(`applications:${spec.key}`)
  const parts = spec.applicationCount >= 60 ? rng.int(2, 4) : 1
  const statuses: ApplicationStatus[] = ['CONFIRMED', 'ENROLLED', 'NEW', 'CONFIRMED']
  const applications: DemoApplication[] = []
  let left = spec.applicationCount
  for (let index = 0; index < parts; index += 1) {
    const quantity = index === parts - 1 ? left : Math.max(1, Math.round(left * rng.uniform(0.3, 0.6)))
    left -= quantity
    applications.push({
      status: statuses[index % statuses.length]!,
      quantity,
      submittedAt: workTimeBefore(addDays(clock.anchor, -rng.uniform(35, 100)), rng),
    })
  }
  // Отклонённый или отозванный пакет — в показатель не входит.
  if (rng.chance(0.4)) {
    applications.push({
      status: rng.pick(['REJECTED', 'CANCELLED'] as const),
      quantity: rng.int(3, 15),
      submittedAt: workTimeBefore(addDays(clock.anchor, -rng.uniform(35, 100)), rng),
    })
  }
  return applications
}

function generatePrograms(clock: Clock, universityCreatedAt: (key: string) => Date | null, universityArchivedAt: (key: string) => Date | null): DemoProgram[] {
  return EXTRA_PROGRAMS.map((spec) => {
    const rng = new Rng(`program:${spec.key}`)
    const universityCreated = universityCreatedAt(spec.university) ?? addDays(clock.anchor, -420)
    const createdAt = addDays(universityCreated, 2)
    const status = spec.status ?? 'ACTIVE'
    const hasMetrics = spec.applicationCount !== null || spec.studentCount !== null || spec.groupCount !== null
    return {
      key: spec.key,
      universityKey: spec.university,
      name: spec.name,
      code: spec.code,
      direction: spec.direction,
      level: spec.level,
      durationMonths: spec.durationMonths,
      status,
      applicationCount: spec.applicationCount,
      studentCount: spec.studentCount,
      groupCount: spec.groupCount,
      metricsUpdatedAt: hasMetrics ? workTimeBefore(addDays(clock.anchor, -rng.uniform(10, 40)), rng) : null,
      createdAt,
      archivedAt:
        status === 'ARCHIVED'
          ? (universityArchivedAt(spec.university) ?? workTimeBefore(addDays(clock.anchor, -rng.uniform(60, 150)), rng))
          : null,
      skills: fillProgramSkills(spec.key, spec.skills),
      applications: generateApplications(spec, clock),
    }
  })
}

// ─────────────────────────────── Рекомендации ─────────────────────────────────

/**
 * Закрытые рекомендации прошлых месяцев — то, что люди сделали с выданными
 * системой. Приоритет — как у правила в момент выдачи: просрочка до недели —
 * «средний», поэтому в ленте они не встают среди открытых критичных (решение 101).
 */
function generateResolvedRecommendations(coops: readonly DemoCooperation[], programs: readonly DemoProgram[]): DemoResolvedRecommendation[] {
  const result: DemoResolvedRecommendation[] = []
  for (const coop of coops) {
    const rng = new Rng(`recommendations:${coop.key}`)
    // Одна рекомендация правила на связку (уникальный ключ): самый поздний закрытый с опозданием этап.
    const late = coop.stages
      .filter((stage) => stage.number !== 14 && stage.status === 'COMPLETED' && stage.completedAt)
      .filter((stage) => stage.completedAt!.getTime() - stage.deadline.getTime() >= 3 * DAY_MS)
      .pop()
    if (late && late.completedAt) {
      const daysOverdue = rng.int(1, 5)
      const createdAt = addDays(late.deadline, daysOverdue)
      if (createdAt < late.completedAt) {
        result.push({
          key: `${coop.key}:stage.overdue`,
          cooperationKey: coop.key,
          programKey: null,
          objectType: 'Cooperation',
          ruleKey: 'stage.overdue',
          type: 'ACTION',
          priority: 'MEDIUM',
          status: 'DONE',
          title: `Просрочен этап ${late.number}: ${late.title}`,
          description: 'Свяжитесь с ответственным и закройте этап либо перенесите срок с комментарием.',
          justification: `Нормативный срок этапа прошёл ${daysOverdue} дн. назад, этап всё ещё в статусе «В работе».`,
          relatedData: { status: 'IN_PROGRESS', deadline: late.deadline.toISOString(), daysOverdue, stageNumber: late.number },
          resolutionComment: rng.pick([
            'Этап закрыт, срок следующих согласован с вузом.',
            'Вуз прислал документы, этап закрыт.',
            'Созвонились с кафедрой, работа возобновлена, этап закрыт.',
          ]),
          createdAt,
          resolvedAt: late.completedAt,
        })
        continue
      }
    }
    // Застой, который менеджер отклонил: у закрытых связок правило больше не сработает.
    if ((coop.status === 'COMPLETED' || coop.status === 'CANCELLED') && coop.closedAt) {
      const createdAt = addDays(coop.closedAt, -rng.uniform(20, 40))
      if (createdAt > coop.startedAt) {
        result.push({
          key: `${coop.key}:cooperation.stalled`,
          cooperationKey: coop.key,
          programKey: null,
          objectType: 'Cooperation',
          ruleKey: 'cooperation.stalled',
          type: 'ACTION',
          priority: 'MEDIUM',
          status: 'DISMISSED',
          title: 'Связка без движения 15 дн.',
          description: 'Уточните у вуза, в силе ли планы, и назначьте следующий шаг.',
          justification: 'По этапам связки не было движения 15 дней.',
          relatedData: { idleDays: 15, lastActivityAt: addDays(createdAt, -15).toISOString() },
          resolutionComment:
            coop.status === 'CANCELLED'
              ? 'Не актуально: вуз письмом прекратил переговоры, связка отменена.'
              : 'Не актуально: кафедра в сессии, работу продолжили после неё.',
          createdAt,
          resolvedAt: addDays(createdAt, rng.uniform(2, 8)),
        })
      }
    }
  }
  // Показатели программ: вуз прислал их после напоминания.
  for (const program of programs) {
    if (program.status !== 'ACTIVE' || program.applicationCount === null || program.studentCount === null || program.groupCount === null) continue
    const rng = new Rng(`recommendations:${program.key}`)
    if (!rng.chance(0.25) || !program.metricsUpdatedAt) continue
    const createdAt = addDays(program.metricsUpdatedAt, -rng.uniform(10, 30))
    result.push({
      key: `${program.key}:program.missing-metrics`,
      cooperationKey: null,
      programKey: program.key,
      objectType: 'EducationalProgram',
      ruleKey: 'program.missing-metrics',
      type: 'PROGRAM',
      priority: 'MEDIUM',
      status: 'DONE',
      title: 'Нет данных по программе: количество обучающихся',
      description: `Запросите у вуза недостающие показатели по программе «${program.name}» или внесите их вручную.`,
      justification: 'Не заполнено показателей: 1 из 3 (количество обучающихся). Без них программа не попадает в рейтинг.',
      relatedData: { missing: ['studentCount'] },
      resolutionComment: 'Вуз прислал показатели набора, внесены в карточку программы.',
      createdAt,
      resolvedAt: program.metricsUpdatedAt,
    })
  }
  return result
}

// ─────────────────────────────── Всплеск спроса ────────────────────────────────

/**
 * Вузы, которые на прошлой неделе попросили показать киберполигон (ключ вуза и
 * сколько встреч). Вузы основного сида — кроме СПбГУТ (сценарий кабинета вуза)
 * и тех, где работа стоит или закрыта.
 */
// Решение 141 подняло фон встреч (4–7 связок на вуз вместо 2–3): счётчики здесь
// увеличены, чтобы всплеск оставался заметно выше фона при любом дне заливки
// (generate.test.ts, «всплеск спроса … ловится детектором», все 7 сдвигов).
export const DEMAND_SPIKE_UNIVERSITIES: ReadonlyArray<readonly [string, number]> = [
  ['unn', 5], ['psuti', 5], ['sfu', 5], ['dvfu', 5], ['uust', 5], ['vsu', 3], ['omgtu', 5],
  ['irnitu', 5], ['kantiana', 5], ['innopolis', 5], ['mtuci', 5], ['kazan', 5], ['nsu', 3], ['urfu', 5],
]

/**
 * Выброс «Встречи» за последние 7 полных дней: после студенческих соревнований на
 * киберполигоне вузы разом просят его показать. Детектор аналитики этапов
 * (решение 120) требует роста больше двух событий в день поверх фона — здесь около
 * шести; встречи — только в рабочие дни среди последних шести полных, чтобы
 * выброс держался в окне при любом дне и часе заливки.
 */
function generateDemandSpike(clock: Clock, primaryContactOf: (key: string) => string | null): DemoUniversityMeeting[] {
  const { anchor } = clock
  const days = recentWorkdays(anchor)
  const meetings: DemoUniversityMeeting[] = []
  for (const [universityKey, count] of DEMAND_SPIKE_UNIVERSITIES) {
    const rng = new Rng(`spike:${universityKey}`)
    for (let index = 0; index < count; index += 1) {
      const date = atWorkHour(rng.pick(days), rng)
      const first = index === 0
      meetings.push({
        key: `spike:${universityKey}:${index}`,
        universityKey,
        responsible: rng.chance(0.5) ? 'manager' : 'manager2',
        date,
        topic: first
          ? 'Презентация киберполигона для кафедры'
          : index === 1 ? 'Разбор сценариев киберполигона с преподавателями' : 'Созвон по условиям пилотного доступа к киберполигону',
        format: first ? rng.pick(['ONLINE', 'CALL'] as const) : index === 1 ? 'ONLINE' : 'CALL',
        result: first
          ? rng.pick(['Кафедра просит пилотный доступ для команды', 'Вуз готов подать заявку на подключение', 'Интерес есть, ждём решения заведующего'])
          : index === 1 ? 'Преподаватели выбрали сценарии для практикума' : 'Условия пилота согласованы, вуз готовит команду',
        nextAction: first ? 'Направить условия пилотного доступа' : index === 1 ? 'Подготовить заявку на подключение' : 'Завести связку после заявки вуза',
        nextActionDueAt: stabilize(clock, addDays(date, rng.int(7, 14))),
        contactKey: primaryContactOf(universityKey),
      })
    }
  }
  return meetings.sort((a, b) => a.date.getTime() - b.date.getTime() || a.key.localeCompare(b.key))
}

// ─────────────────────────────── Сборка ───────────────────────────────────────

export function generateDemoData(options: DemoOptions): DemoData {
  const clock: Clock = {
    anchor: options.anchor,
    shift: Math.max(0, options.stableUntil.getTime() - options.anchor.getTime()),
  }

  // Контакты нужны встречам раньше, чем вузы получат даты: ключи известны заранее.
  const primaryContactOf = (universityKey: string) => {
    const spec = EXTRA_UNIVERSITIES.find((item) => item.key === universityKey)
    const index = spec?.contacts.findIndex((contact) => contact.isPrimary) ?? -1
    return index >= 0 ? `${universityKey}-${index}` : null
  }
  const secondContactOf = (universityKey: string) => {
    const spec = EXTRA_UNIVERSITIES.find((item) => item.key === universityKey)
    const index = spec?.contacts.findIndex((contact) => !contact.isPrimary && contact.basis.kind !== 'WITHDRAWN') ?? -1
    return index >= 0 ? `${universityKey}-${index}` : null
  }

  const cooperations = COOPERATION_SPECS.map((spec) =>
    generateCooperation(spec, { clock, primaryContactOf, secondContactOf }),
  )

  const earliestStart = new Map<string, Date>()
  for (const coop of cooperations) {
    const known = earliestStart.get(coop.universityKey)
    if (!known || coop.startedAt < known) earliestStart.set(coop.universityKey, coop.startedAt)
  }
  const universities = generateUniversities(clock, earliestStart)
  const universityCreatedAt = (key: string) => universities.find((item) => item.key === key)?.createdAt ?? null
  const universityArchivedAt = (key: string) => universities.find((item) => item.key === key)?.archivedAt ?? null
  const programs = generatePrograms(clock, universityCreatedAt, universityArchivedAt)

  // Продукт заведён раньше первой связки с ним.
  const products: DemoProduct[] = EXTRA_PRODUCTS.map((spec) => {
    const rng = new Rng(`product:${spec.key}`)
    let createdAt = workTimeBefore(addDays(options.anchor, -spec.createdDaysAgo), rng)
    for (const coop of cooperations) {
      if (coop.productKey === spec.key && coop.startedAt < addDays(createdAt, 14)) createdAt = addDays(coop.startedAt, -14)
    }
    return {
      key: spec.key,
      name: spec.name,
      category: spec.category,
      description: spec.description,
      version: spec.version,
      status: spec.status,
      createdAt,
      updatedAt: maxDate(createdAt, workTimeBefore(addDays(options.anchor, -spec.updatedDaysAgo), rng)),
      skills: spec.skills,
    }
  })

  const market: DemoMarketRow[] = []
  for (const [period, values] of Object.entries(EXTRA_MARKET)) {
    for (const [skill, value] of Object.entries(values)) market.push({ skill, period, value, region: 'Россия', source: 'base' })
  }
  const q2 = EXTRA_MARKET[REGIONAL_SOURCE.period]!
  for (const skill of REGIONAL_SOURCE.skills) {
    for (const [region, share] of Object.entries(REGIONAL_SOURCE.regions)) {
      const rng = new Rng(`market:${skill}:${region}`)
      market.push({ skill, period: REGIONAL_SOURCE.period, value: Math.round((q2[skill]! * share * rng.uniform(0.85, 1.15)) / 10) * 10, region, source: 'regional' })
    }
  }

  return {
    anchor: options.anchor,
    stableUntil: options.stableUntil,
    skills: [...EXTRA_SKILLS, ...MORE_SKILLS],
    market,
    products,
    universities,
    programs,
    cooperations,
    universityMeetings: generateDemandSpike(clock, primaryContactOf),
    resolvedRecommendations: generateResolvedRecommendations(cooperations, programs),
  }
}

/**
 * История этапов связки: где и когда она была. Порядок — по входу в этап,
 * без этапа 5, отменённого как ненужный (в него не входили). Этап 14 — только у
 * связок, прошедших все этапы: вход и выход — закрытие последнего.
 *
 * Функция отдельная и чистая: когда появится таблица истории этапов
 * (`cooperation_stage_history`, решение 120), её строки пишутся ровно отсюда.
 */
export function buildStageTimeline(coop: Pick<DemoCooperation, 'stages'>): StageTimelineEntry[] {
  const entries: StageTimelineEntry[] = []
  for (const stage of coop.stages) {
    if (stage.number === 14 || !stage.startedAt) continue
    entries.push({ stage: stage.number, enteredAt: stage.startedAt, leftAt: stage.endedAt })
  }
  entries.sort((a, b) => a.enteredAt.getTime() - b.enteredAt.getTime() || a.stage - b.stage)
  const control = coop.stages.find((stage) => stage.number === 14)
  if (control?.status === 'COMPLETED' && control.completedAt) {
    entries.push({ stage: 14, enteredAt: control.completedAt, leftAt: control.completedAt })
  }
  return entries
}
