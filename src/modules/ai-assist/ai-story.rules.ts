import { RECOMMENDATION_RULES } from '@/shared/config/analytics.config'
import { AI_PROPOSAL, AI_STORY, RU_HOLIDAYS_MM_DD } from '@/shared/config/ai-assist.config'
import { CONTROL_STAGE_NUMBER, SIGNING_STAGE_NUMBER } from '@/shared/config/workflow.config'
import { COOPERATION_STATUS_LABELS, STAGE_STATUS_LABELS } from '@/shared/contracts/labels'
import {
  BLOCKER_CODES,
  type BlockerDto,
  type MeetingProposalPayload,
  type StageRefDto,
  type TaskProposalPayload,
} from '@/shared/contracts/ai-story'
import type { CooperationDto } from '@/shared/contracts/cooperation'
import { isClosedStatus } from '@/modules/cooperation/cooperation.rules'
import { findBlockingStages, isAutoManaged, isControlPoint } from '@/modules/workflow/workflow.rules'
import { moscowIsoDate } from '@/shared/utils/date'
import { countWithNoun } from '@/shared/utils/text'

/**
 * «История сотрудничества» и «Что мешает» (решение 138).
 *
 * Числа считает код: каждая функция здесь — чистая, без обращения к базе и без
 * модели. Она либо собирает факты из уже загруженной карточки связки (та же
 * `CooperationDto`, что видит интерфейс), либо строит из фактов текст.
 * Что «мешает» и в каком порядке — те же правила, что у контрольных точек
 * и рекомендаций (`workflow.rules`, `recommendations.rules`), просто собранные
 * в одно место для короткого списка на карточке.
 */

type Stage = CooperationDto['stages'][number]

/**
 * Свободный текст (причина блокировки) — не длиннее `AI_STORY.freeTextMaxLength`,
 * прежде чем стать фактом: история — короткая сводка, а не пересказ переписки.
 */
function freeText(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > AI_STORY.freeTextMaxLength
    ? `${trimmed.slice(0, AI_STORY.freeTextMaxLength - 1).trimEnd()}…`
    : trimmed
}

export function toStageRef(stage: Stage): StageRefDto {
  return { id: stage.id, stageNumber: stage.stageNumber, title: stage.title, status: stage.status }
}

/** Открытые этапы (не завершены, не отменены, не вычисляемый этап 14) по порядку номера. */
function openStages(stages: readonly Stage[]): Stage[] {
  return stages
    .filter((stage) => stage.status !== 'COMPLETED' && stage.status !== 'CANCELLED')
    .filter((stage) => !isAutoManaged(stage.stageNumber))
    .sort((a, b) => a.stageNumber - b.stageNumber)
}

/** Текущий и следующий открытые этапы — как на карточке связки, плюс один вперёд. */
export function currentAndNextStage(stages: readonly Stage[]): { current: Stage | null; next: Stage | null } {
  const [current = null, next = null] = openStages(stages)
  return { current, next }
}

export interface DocumentsSummary {
  signed: number
  total: number
}

export interface MeetingsSummary {
  total: number
  lastAt: string | null
}

export interface BlockerInput {
  cooperation: Pick<CooperationDto, 'id' | 'status' | 'productId' | 'stages'>
  documents: DocumentsSummary
}

/**
 * Что мешает перейти к следующему этапу — коды в порядке важности из контракта
 * (`BLOCKER_CODES`). Первый найденный код и есть «главное препятствие»:
 * дальше по списку — то, что тоже верно, но решать раньше главного бессмысленно.
 */
export function computeBlockers(input: BlockerInput): BlockerDto[] {
  const { cooperation, documents } = input
  const blockers: BlockerDto[] = []
  const stages = cooperation.stages

  if (isClosedStatus(cooperation.status)) {
    blockers.push({
      code: 'COOPERATION_CLOSED',
      detail: `Связка в статусе «${COOPERATION_STATUS_LABELS[cooperation.status]}»: этапы не ведутся`,
      link: `/cooperations/${cooperation.id}`,
      stageNumber: null,
    })
    return blockers
  }
  if (cooperation.status === 'PAUSED') {
    blockers.push({
      code: 'COOPERATION_PAUSED',
      detail: 'Связка приостановлена: возобновите её, чтобы продолжить работу по этапам',
      link: `/cooperations/${cooperation.id}`,
      stageNumber: null,
    })
  }

  const { current, next } = currentAndNextStage(stages)
  if (!current) return blockers

  if (current.status === 'BLOCKED') {
    blockers.push({
      code: 'STAGE_BLOCKED',
      detail: `Этап ${current.stageNumber} «${current.title}» заблокирован: ${
        current.blockingReason?.trim() ? freeText(current.blockingReason) : 'причина не указана'
      }`,
      link: `/cooperations/${cooperation.id}/stages/${current.id}`,
      stageNumber: current.stageNumber,
    })
  }

  if (current.status === 'NOT_STARTED') {
    const blocking = findBlockingStages(current.stageNumber, stages)
    if (blocking.length > 0) {
      blockers.push({
        code: 'CONTROL_POINT',
        detail:
          `Этап ${current.stageNumber} «${current.title}» ждёт контрольную точку: ` +
          `не закрыты ${blocking.map((stage) => `${stage.stageNumber} «${stage.title}»`).join(', ')}`,
        link: `/cooperations/${cooperation.id}/stages/${current.id}`,
        stageNumber: current.stageNumber,
      })
    }
  }

  const noProduct =
    !cooperation.productId &&
    current.stageNumber >= RECOMMENDATION_RULES.productRequiredFromStage &&
    current.stageNumber < CONTROL_STAGE_NUMBER
  if (noProduct) {
    blockers.push({
      code: 'PRODUCT_NOT_SELECTED',
      detail: `Связка дошла до этапа ${current.stageNumber}, а IT-продукт ещё не выбран`,
      link: `/cooperations/${cooperation.id}`,
      stageNumber: current.stageNumber,
    })
  }

  if (current.stageNumber === SIGNING_STAGE_NUMBER && documents.signed === 0) {
    blockers.push({
      code: 'DOCUMENTS_NOT_SIGNED',
      detail: 'Этап подписания документов, а подписанных документов пока нет',
      link: `/cooperations/${cooperation.id}/documents`,
      stageNumber: current.stageNumber,
    })
  }

  const universityPending = current.tasks.find(
    (task) => task.isUniversityItem && !task.isDone && task.staffMarkRule === 'UNIVERSITY_ONLY',
  )
  if (universityPending) {
    blockers.push({
      code: 'UNIVERSITY_ITEM_PENDING',
      detail: `Ждём вуз: пункт «${universityPending.title}» отмечает представитель вуза в кабинете`,
      link: `/cooperations/${cooperation.id}/stages/${current.id}`,
      stageNumber: current.stageNumber,
    })
  }

  if (current.requiredTasksDone < current.requiredTasksTotal && !universityPending) {
    blockers.push({
      code: 'REQUIRED_TASKS_OPEN',
      detail:
        `Не закрыты обязательные пункты чек-листа этапа ${current.stageNumber}: ` +
        `${current.requiredTasksDone} из ${current.requiredTasksTotal}`,
      link: `/cooperations/${cooperation.id}/stages/${current.id}`,
      stageNumber: current.stageNumber,
    })
  }

  if (current.status === 'NOT_STARTED' && blockers.every((blocker) => blocker.stageNumber !== current.stageNumber)) {
    blockers.push({
      code: 'STAGE_NOT_STARTED',
      detail: `Этап ${current.stageNumber} «${current.title}» ещё не начат`,
      link: `/cooperations/${cooperation.id}/stages/${current.id}`,
      stageNumber: current.stageNumber,
    })
  }

  if (
    current.status === 'IN_PROGRESS' &&
    current.requiredTasksDone === current.requiredTasksTotal &&
    !current.result
  ) {
    blockers.push({
      code: 'RESULT_MISSING',
      detail: `Пункты этапа ${current.stageNumber} закрыты, а результат ещё не записан`,
      link: `/cooperations/${cooperation.id}/stages/${current.id}`,
      stageNumber: current.stageNumber,
    })
  }

  if (next && isControlPoint(next.stageNumber)) {
    const blocking = findBlockingStages(next.stageNumber, stages).filter(
      (stage) => stage.stageNumber !== current.stageNumber,
    )
    if (blocking.length > 0) {
      blockers.push({
        code: 'NEXT_CONTROL_POINT',
        detail:
          `Следующий этап ${next.stageNumber} «${next.title}» — контрольная точка: ` +
          `перед ним нужно закрыть ещё ${blocking.map((stage) => `${stage.stageNumber} «${stage.title}»`).join(', ')}`,
        link: `/cooperations/${cooperation.id}/stages/${next.id}`,
        stageNumber: next.stageNumber,
      })
    }
  }

  return blockers
}

/**
 * Главное препятствие среди нескольких связок (история вуза): у кого код раньше
 * в `BLOCKER_CODES`, тот и главный — тот же порядок важности, что у одной связки.
 */
export function pickMainBlocker(candidates: readonly BlockerDto[]): BlockerDto | null {
  if (candidates.length === 0) return null
  return [...candidates].sort(
    (a, b) => BLOCKER_CODES.indexOf(a.code) - BLOCKER_CODES.indexOf(b.code),
  )[0]!
}

/** Момент, на который посчитаны данные: самое позднее изменение среди источников. */
export function latestOf(...dates: ReadonlyArray<string | null>): string {
  const times = dates.filter((value): value is string => value !== null).map((value) => new Date(value).getTime())
  return new Date(times.length > 0 ? Math.max(...times) : Date.now()).toISOString()
}

// ─────────────────────────── Факты истории связки ────────────────────────────

export interface CooperationStoryFacts {
  universityName: string
  universityShortName: string | null
  programName: string
  productName: string | null
  status: CooperationDto['status']
  current: StageRefDto | null
  totalStages: number
  closedStages: number
  documents: DocumentsSummary
  meetings: MeetingsSummary
  openRecommendations: number
  mainBlocker: BlockerDto | null
  classesStartAt: string | null
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Moscow',
  }).format(date)
}

/** Строки фактов истории связки — то, что видит человек и (в маскированном виде) модель. */
export function cooperationStoryLines(facts: CooperationStoryFacts): string[] {
  const lines = [
    `Вуз: ${facts.universityName}${facts.universityShortName ? ` (${facts.universityShortName})` : ''}`,
    `Программа: «${facts.programName}»`,
    `IT-продукт: ${facts.productName ? `«${facts.productName}»` : 'не выбран'}`,
    `Статус связки: ${COOPERATION_STATUS_LABELS[facts.status]}`,
    `Пройдено этапов: ${facts.closedStages} из ${facts.totalStages}`,
    `Текущий этап: ${
      facts.current
        ? `${facts.current.stageNumber} «${facts.current.title}», статус «${STAGE_STATUS_LABELS[facts.current.status]}»`
        : 'нет — все этапы закрыты'
    }`,
    `Документы: подписано ${facts.documents.signed} из ${facts.documents.total}`,
    `Встречи: ${facts.meetings.total}${
      facts.meetings.lastAt ? `, последняя ${formatDate(facts.meetings.lastAt)}` : ', ещё не было'
    }`,
    `Открытых рекомендаций: ${facts.openRecommendations}`,
    `Главное препятствие: ${facts.mainBlocker ? facts.mainBlocker.detail : 'нет'}`,
  ]
  const classes = formatDate(facts.classesStartAt)
  lines.push(`Начало занятий: ${classes ?? 'не указано'}`)
  return lines
}

/** История связки без модели: 3–5 предложений из тех же фактов. */
export function cooperationStoryTemplate(facts: CooperationStoryFacts): string {
  const where = `${facts.universityShortName ?? facts.universityName} — «${facts.programName}»`
  const product = facts.productName ? `с продуктом «${facts.productName}»` : 'без выбранного IT-продукта'

  const sentences: string[] = [
    facts.current
      ? `Связка ${where} ${product}, сейчас на этапе ${facts.current.stageNumber} «${facts.current.title}» ` +
        `(${STAGE_STATUS_LABELS[facts.current.status].toLowerCase()}), пройдено ${facts.closedStages} из ${facts.totalStages} этапов.`
      : `Связка ${where} ${product}: закрыто ${facts.closedStages} из ${facts.totalStages} этапов.`,
    facts.mainBlocker ? `Мешает дальше: ${facts.mainBlocker.detail}.` : 'Сейчас ничего не мешает двигаться дальше.',
    `Документы: подписано ${facts.documents.signed} из ${facts.documents.total}, встреч проведено ${facts.meetings.total}.`,
  ]

  sentences.push(
    facts.openRecommendations > 0
      ? `Открытых рекомендаций по связке: ${facts.openRecommendations}.`
      : 'Открытых рекомендаций по связке нет.',
  )

  const classes = formatDate(facts.classesStartAt)
  sentences.push(classes ? `Начало занятий: ${classes}.` : 'Дата начала занятий не указана.')

  return sentences.slice(0, AI_STORY.maxSentences).join(' ')
}

// ─────────────────────────── Факты истории вуза ───────────────────────────────

export interface UniversityCooperationBrief {
  id: string
  programName: string
  status: CooperationDto['status']
  currentStage: StageRefDto | null
}

export interface UniversityStoryFacts {
  universityName: string
  universityShortName: string | null
  cooperationsTotal: number
  cooperationsActive: number
  cooperationsCompleted: number
  listed: UniversityCooperationBrief[]
  meetings: MeetingsSummary
  openRecommendations: number
  mainBlocker: BlockerDto | null
}

export function universityStoryLines(facts: UniversityStoryFacts): string[] {
  return [
    `Вуз: ${facts.universityName}${facts.universityShortName ? ` (${facts.universityShortName})` : ''}`,
    `Связок всего: ${facts.cooperationsTotal}, в работе: ${facts.cooperationsActive}, завершено: ${facts.cooperationsCompleted}`,
    `Связки в работе: ${
      facts.listed.length === 0
        ? 'нет'
        : facts.listed
            .map(
              (item) =>
                `«${item.programName}» (${COOPERATION_STATUS_LABELS[item.status]}${
                  item.currentStage ? `, этап ${item.currentStage.stageNumber} «${item.currentStage.title}»` : ''
                })`,
            )
            .join('; ')
    }`,
    `Встречи: ${facts.meetings.total}${
      facts.meetings.lastAt ? `, последняя ${formatDate(facts.meetings.lastAt)}` : ', ещё не было'
    }`,
    `Открытых рекомендаций: ${facts.openRecommendations}`,
    `Главное препятствие: ${facts.mainBlocker ? facts.mainBlocker.detail : 'нет'}`,
  ]
}

export function universityStoryTemplate(facts: UniversityStoryFacts): string {
  const sentences: string[] = [
    `У вуза ${facts.universityShortName ?? facts.universityName} ${countWithNoun(facts.cooperationsTotal, [
      'связка',
      'связки',
      'связок',
    ])}: в работе ${facts.cooperationsActive}, завершено ${facts.cooperationsCompleted}.`,
  ]

  if (facts.listed.length > 0) {
    sentences.push(
      `В работе: ${facts.listed
        .map((item) => `«${item.programName}»${item.currentStage ? ` (этап ${item.currentStage.stageNumber})` : ''}`)
        .join('; ')}.`,
    )
  }

  sentences.push(
    facts.mainBlocker ? `Мешает дальше: ${facts.mainBlocker.detail}.` : 'Сейчас ничего не мешает двигаться дальше.',
  )
  sentences.push(
    facts.meetings.total > 0
      ? `Встреч с вузом было ${facts.meetings.total}${
          facts.meetings.lastAt ? `, последняя ${formatDate(facts.meetings.lastAt)}` : ''
        }.`
      : 'Встреч с вузом ещё не было.',
  )
  sentences.push(
    facts.openRecommendations > 0
      ? `Открытых рекомендаций: ${facts.openRecommendations}.`
      : 'Открытых рекомендаций нет.',
  )

  return sentences.slice(0, AI_STORY.maxSentences).join(' ')
}

// ─────────────────────────── Ответ модели: проверки ───────────────────────────

/** Сколько предложений в тексте — по точке, восклицательному и вопросительному знаку. */
export function countSentences(text: string): number {
  const trimmed = text.trim()
  if (trimmed === '') return 0
  return trimmed.split(/(?<=[.!?])\s+(?=\S)/).filter((part) => part.trim().length > 0).length
}

// ─────────────────────────── Предложить план ──────────────────────────────────

/** «ММ-ДД» из ISO-даты по Москве — для сверки с `RU_HOLIDAYS_MM_DD`. */
function moscowMonthDay(isoDate: string): string {
  return isoDate.slice(5, 10)
}

function isMoscowWeekend(isoDate: string): boolean {
  const weekday = new Date(`${isoDate}T00:00:00Z`).getUTCDay()
  return weekday === 0 || weekday === 6
}

export interface WorkingDayResult {
  /** Календарная дата по Москве, «ГГГГ-ММ-ДД». */
  isoDate: string
  /** Сдвиг в календарных днях от `now`, при котором дата найдена. */
  shiftDays: number
  /** Дата дальше обычного окна `minDaysAhead`–`maxDaysAhead` — праздники сдвинули её. */
  extended: boolean
}

/**
 * Ближайший рабочий день по Москве в окне `minDaysAhead`–`maxDaysAhead` дней от `now`;
 * если всё окно — выходные и праздники (короткий Новый год), поиск продолжается дальше,
 * а `extended: true` — предупреждение для интерфейса.
 */
export function nextWorkingDay(
  now: Date,
  minDaysAhead: number = AI_PROPOSAL.minDaysAhead,
  maxDaysAhead: number = AI_PROPOSAL.maxDaysAhead,
  holidays: readonly string[] = RU_HOLIDAYS_MM_DD,
): WorkingDayResult {
  const isWorkingDay = (isoDate: string) => !isMoscowWeekend(isoDate) && !holidays.includes(moscowMonthDay(isoDate))

  for (let shift = minDaysAhead; shift <= maxDaysAhead; shift += 1) {
    const isoDate = moscowIsoDate(now, shift)
    if (isWorkingDay(isoDate)) return { isoDate, shiftDays: shift, extended: false }
  }
  // Окно целиком выходные — ищем дальше, но не бесконечно: не больше двух недель сверху.
  for (let shift = maxDaysAhead + 1; shift <= maxDaysAhead + 14; shift += 1) {
    const isoDate = moscowIsoDate(now, shift)
    if (isWorkingDay(isoDate)) return { isoDate, shiftDays: shift, extended: true }
  }
  // Практически недостижимо (две недели подряд без единого буднего дня), но без падения:
  // берём первый день окна как есть.
  return { isoDate: moscowIsoDate(now, minDaysAhead), shiftDays: minDaysAhead, extended: true }
}

/**
 * Момент времени в московском часовом поясе: календарная дата + час по Москве, строкой ISO 8601 в UTC.
 * Смещение Москвы от UTC — постоянные +3 часа (переход на летнее время отменён в 2014-м).
 */
export function moscowDateTime(isoDate: string, hourMsk: number): string {
  const midnightMskAsUtc = new Date(`${isoDate}T00:00:00.000Z`).getTime() - 3 * 60 * 60_000
  return new Date(midnightMskAsUtc + hourMsk * 60 * 60_000).toISOString()
}

/** Повестка встречи по блокерам: не длиннее `AI_PROPOSAL.agendaMaxItems`, плюс «следующий шаг». */
export function buildAgenda(blockers: readonly BlockerDto[]): string[] {
  const items = blockers.slice(0, AI_PROPOSAL.agendaMaxItems - 1).map((blocker) => blocker.detail)
  items.push('Следующий шаг и новый срок этапа')
  return items.slice(0, AI_PROPOSAL.agendaMaxItems)
}

/** Тема встречи из повестки — обрезана до предела поля темы в базе (meetings.schema.ts). */
export function buildMeetingTopic(cooperationLabel: string, agenda: readonly string[]): string {
  const topic = `Связка ${cooperationLabel}: ${agenda.join('; ')}`
  return topic.length > AI_PROPOSAL.topicMaxLength
    ? `${topic.slice(0, AI_PROPOSAL.topicMaxLength - 1).trimEnd()}…`
    : topic
}

/**
 * Вид проекта, когда его не выбрал вызывающий: есть препятствия — нужен разговор
 * с вузом (`meeting`), нет — просто нужен новый реалистичный срок этапа (`task`).
 */
export function chooseProposalKind(blockers: readonly BlockerDto[]): 'meeting' | 'task' {
  return blockers.length > 0 ? 'meeting' : 'task'
}

export interface TaskProposalInput {
  stageId: string
  stageNumber: number
  stageTitle: string
  currentDeadline: string | null
}

export function buildTaskProposalPayload(
  stage: TaskProposalInput,
  workingDay: WorkingDayResult,
): TaskProposalPayload {
  return {
    kind: 'task',
    title: `Новый срок этапа ${stage.stageNumber}: «${stage.stageTitle}»`,
    stageId: stage.stageId,
    stageNumber: stage.stageNumber,
    stageTitle: stage.stageTitle,
    currentDeadline: stage.currentDeadline,
    dueDate: moscowDateTime(workingDay.isoDate, AI_PROPOSAL.taskDueHourMsk),
  }
}

export function buildMeetingProposalPayload(
  cooperationId: string,
  cooperationLabel: string,
  responsibleId: string,
  blockers: readonly BlockerDto[],
  workingDay: WorkingDayResult,
): MeetingProposalPayload {
  const agenda = buildAgenda(blockers)
  return {
    kind: 'meeting',
    topic: buildMeetingTopic(cooperationLabel, agenda),
    agenda,
    date: moscowDateTime(workingDay.isoDate, AI_PROPOSAL.meetingHourMsk),
    format: 'ONLINE',
    responsibleId,
    cooperationId,
  }
}

/** Предупреждения к проекту — на что обратить внимание перед сохранением. */
export function buildProposalWarnings(workingDay: WorkingDayResult, blockers: readonly BlockerDto[]): string[] {
  const warnings: string[] = []
  if (workingDay.extended) {
    warnings.push(
      'Ближайшие рабочие дни заняты выходными или праздниками: дата предложена дальше обычного окна в 3–5 дней',
    )
  }
  if (blockers.length === 0) {
    warnings.push('Явных препятствий не найдено — предложен только новый срок этапа')
  }
  return warnings
}
