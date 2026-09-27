import { DEADLINE_WARNING_DAYS } from '@/shared/config/analytics.config'
import type { DocumentStatus, RecommendationPriority, StageStatus } from '@/shared/contracts/enums'
import type {
  NotificationDto,
  NotificationFeedDto,
  NotificationSeverity,
} from '@/shared/contracts/notification'
import { documentEventTitle, stageEventTitle } from '@/modules/audit/audit.rules'
import { isDueSoon, isOverdue } from '@/modules/workflow/workflow.rules'
import {
  daysBetweenIso,
  dueDateValue,
  isAssignmentOverdue,
  todayIso,
} from '@/modules/assignments/assignments.rules'
import type { AssignmentPriority, AssignmentStatus } from '@/shared/contracts/enums'

const DAY_MS = 24 * 60 * 60 * 1000

/** Незакрытый этап со сроком, где пользователь — ответственный. */
export interface StageDeadlineSource {
  stageId: string
  stageNumber: number
  stageTitle: string
  status: StageStatus
  deadline: Date
  cooperationId: string
  universityName: string
  programName: string
  /**
   * Этап не начат и стоит за незавершённой контрольной точкой (`isLockedByControlPoint`):
   * начать его нельзя, и напоминать о его сроке — значит торопить с запрещённым.
   */
  lockedByControlPoint: boolean
}

/** Смена статуса этапа, сделанная кем-то другим. */
export interface StageChangeSource {
  historyId: string
  stageId: string
  stageNumber: number
  stageTitle: string
  toStatus: StageStatus
  changedAt: Date
  cooperationId: string
  universityName: string
  programName: string
  authorName: string | null
}

export interface DocumentChangeSource {
  historyId: string
  documentId: string
  title: string
  version: string
  toStatus: DocumentStatus
  changedAt: Date
  cooperationId: string | null
  universityName: string | null
}

export interface RecommendationSource {
  id: string
  /** Правило рекомендации: по нему видно, о каком событии она говорит. */
  ruleKey: string
  /** Номер этапа, если рекомендация о конкретном этапе (просрочка), иначе null. */
  stageNumber: number | null
  title: string
  /** Имя объекта: «СПбГУТ — Программная инженерия». Заголовок его не содержит. */
  label: string
  priority: RecommendationPriority
  createdAt: Date
  cooperationId: string | null
}

/**
 * Пользователя назначили или сняли ответственным (`assigned: false` — сняли: ответственным
 * стал кто-то другой или никто). За вуз — решение 146; за связку и за этап — решение 205.
 */
interface ResponsibleAssignedBase {
  auditLogId: string
  universityName: string
  assigned: boolean
  changedAt: Date
}

export type ResponsibleAssignedSource =
  | (ResponsibleAssignedBase & { scope: 'university'; universityId: string })
  | (ResponsibleAssignedBase & { scope: 'cooperation'; cooperationId: string; programName: string })
  | (ResponsibleAssignedBase & {
      scope: 'stage'
      cooperationId: string
      programName: string
      stageId: string
      stageNumber: number
      stageTitle: string
    })

/** Открытое поручение пользователю (решение 207). */
export interface AssignmentFeedSource {
  id: string
  text: string
  status: AssignmentStatus
  priority: AssignmentPriority
  /** Срок — календарная дата `ГГГГ-ММ-ДД`. */
  dueDate: string
  /** Краткое название вуза; `null` — поручение без вуза. */
  universityName: string | null
  cooperationId: string | null
  /** Поручил не сам пользователь — тогда оно «новое» для него. */
  fromSomeoneElse: boolean
  createdAt: Date
}

export interface FeedSources {
  deadlines: StageDeadlineSource[]
  stageChanges: StageChangeSource[]
  documentChanges: DocumentChangeSource[]
  recommendations: RecommendationSource[]
  responsibleAssignments: ResponsibleAssignedSource[]
  /** Открытые поручения пользователю (решение 207); у представителя вуза их нет. */
  assignments: AssignmentFeedSource[]
}

/** Длиннее — обрезаем с многоточием: заголовок пункта ленты в одну-две строки. */
const ASSIGNMENT_TITLE_TEXT = 90

function quoteAssignment(text: string): string {
  const short = text.length > ASSIGNMENT_TITLE_TEXT ? `${text.slice(0, ASSIGNMENT_TITLE_TEXT - 1).trimEnd()}…` : text
  return `«${short}»`
}

function assignmentWhere(source: AssignmentFeedSource, dueText: string): string {
  return [source.universityName, dueText].filter(Boolean).join(' · ')
}

/**
 * Пункты ленты по поручению: «Вам поручение» — если дал кто-то другой; «Срок поручения
 * завтра» — накануне; «Срок поручения прошёл» — после дня срока. Просрочка — тем же
 * правилом, что список поручений (`isAssignmentOverdue`). Время события — когда оно
 * наступило: создание, начало дня накануне срока, начало дня после срока (по Москве) —
 * иначе «прочитано» не работало бы, как и у сроков этапов.
 */
function assignmentItems(source: AssignmentFeedSource, now: Date): Array<Omit<NotificationDto, 'isUnread'>> {
  const today = todayIso(now)
  const target = { type: 'assignment' as const, id: source.id, cooperationId: source.cooperationId, stageId: null }
  const [year, month, day] = source.dueDate.split('-')
  const dueText = `срок ${day}.${month}.${year}`
  const items: Array<Omit<NotificationDto, 'isUnread'>> = []
  if (source.fromSomeoneElse) {
    items.push({
      id: `assignment-new:${source.id}`,
      kind: 'assignment.new',
      severity: source.priority === 'HIGH' ? 'warning' : 'info',
      title: `Вам поручение${source.priority === 'HIGH' ? ' (важное)' : ''}: ${quoteAssignment(source.text)}`,
      description: assignmentWhere(source, dueText),
      occurredAt: source.createdAt.toISOString(),
      target,
    })
  }
  // Начало московских суток даты `iso`: столбец `date` — полночь UTC, по Москве это 03:00.
  const moscowStart = (iso: string) => new Date(dueDateValue(iso).getTime() - 3 * 60 * 60 * 1000)
  if (isAssignmentOverdue(source.dueDate, source.status, today)) {
    items.push({
      id: `assignment-overdue:${source.id}`,
      kind: 'assignment.overdue',
      severity: 'critical',
      title: `Срок поручения прошёл: ${quoteAssignment(source.text)}`,
      description: assignmentWhere(source, dueText),
      occurredAt: new Date(moscowStart(source.dueDate).getTime() + DAY_MS).toISOString(),
      target,
    })
  } else if (daysBetweenIso(today, source.dueDate) === 1) {
    items.push({
      id: `assignment-due-soon:${source.id}`,
      kind: 'assignment.due-soon',
      severity: 'warning',
      title: `Срок поручения завтра: ${quoteAssignment(source.text)}`,
      description: assignmentWhere(source, dueText),
      occurredAt: moscowStart(today).toISOString(),
      target,
    })
  }
  return items
}

function where(universityName: string, programName: string): string {
  return `${universityName} — ${programName}`
}

function withAuthor(text: string, authorName: string | null): string {
  return authorName ? `${text} · ${authorName}` : text
}

/** Ключ события «просрочен этап» — вид события и объект, одинаковый у обоих источников. */
function overdueEventKey(cooperationId: string, stageNumber: number): string {
  return `stage.overdue:${cooperationId}:${stageNumber}`
}

const RECOMMENDATION_SEVERITY: Record<RecommendationPriority, NotificationSeverity> = {
  CRITICAL: 'critical',
  HIGH: 'warning',
  MEDIUM: 'info',
  LOW: 'info',
}

/** Пункт ленты о назначении или снятии ответственным: заголовок и куда ведёт. */
function responsibleItem(
  change: ResponsibleAssignedSource,
): Pick<NotificationDto, 'kind' | 'title' | 'description' | 'occurredAt' | 'target'> {
  const occurredAt = change.changedAt.toISOString()
  switch (change.scope) {
    case 'university':
      return {
        kind: 'university.responsible-changed',
        title: change.assigned
          ? `Вы назначены ответственным за вуз «${change.universityName}»`
          : `Вы больше не ответственный за вуз «${change.universityName}»`,
        description: null,
        occurredAt,
        target: { type: 'university', id: change.universityId, cooperationId: null, stageId: null },
      }
    case 'cooperation':
      return {
        kind: 'cooperation.responsible-changed',
        title: change.assigned ? 'Вы назначены ответственным за связку' : 'Вы больше не ответственный за связку',
        description: where(change.universityName, change.programName),
        occurredAt,
        target: { type: 'cooperation', id: change.cooperationId, cooperationId: change.cooperationId, stageId: null },
      }
    case 'stage':
      return {
        kind: 'stage.responsible-changed',
        title: change.assigned
          ? `Вы назначены ответственным за этап ${change.stageNumber} «${change.stageTitle}»`
          : `Вы больше не ответственный за этап ${change.stageNumber} «${change.stageTitle}»`,
        description: where(change.universityName, change.programName),
        occurredAt,
        target: {
          type: 'cooperation',
          id: change.cooperationId,
          cooperationId: change.cooperationId,
          stageId: change.stageId,
        },
      }
  }
}

/**
 * Собирает ленту из источников.
 *
 * Просроченный этап и этап «скоро срок» — один и тот же источник, и попадает он
 * ровно в одно состояние: правила `isOverdue` и `isDueSoon` те же, что у карточки
 * связки, и друг друга исключают.
 *
 * Время события — когда оно случилось, а не когда его посчитали: для просрочки —
 * истёкший срок, для «скоро срок» — момент входа в окно предупреждения.
 * Иначе «отметить всё прочитанным» не работало бы: при каждом запросе
 * просрочка выглядела бы новой.
 */
export function buildFeed(
  sources: FeedSources,
  options: { now: Date; since: Date | null; limit: number },
): NotificationFeedDto {
  const { now, since, limit } = options
  const items: Array<Omit<NotificationDto, 'isUnread'>> = []

  // Одно событие — одно уведомление. Просрочку этапа знают два источника: срок
  // этапа и рекомендация «Просрочен этап N». Остаётся пункт срока: он ведёт прямо
  // к этапу, где делается работа, и его время — истёкший срок, так что пересборка
  // рекомендаций не выдаёт давно известную просрочку за новую.
  const overdueEvents = new Set<string>()

  for (const stage of sources.deadlines) {
    if (stage.lockedByControlPoint) continue
    const target = {
      type: 'cooperation' as const,
      id: stage.cooperationId,
      cooperationId: stage.cooperationId,
      stageId: stage.stageId,
    }
    if (isOverdue(stage.deadline, stage.status, now)) {
      overdueEvents.add(overdueEventKey(stage.cooperationId, stage.stageNumber))
      items.push({
        id: `stage-overdue:${stage.stageId}`,
        kind: 'stage.overdue',
        severity: 'critical',
        title: `Просрочен этап ${stage.stageNumber} «${stage.stageTitle}»`,
        description: where(stage.universityName, stage.programName),
        occurredAt: stage.deadline.toISOString(),
        target,
      })
    } else if (isDueSoon(stage.deadline, stage.status, now)) {
      const enteredWindow = new Date(stage.deadline.getTime() - DEADLINE_WARNING_DAYS * DAY_MS)
      items.push({
        id: `stage-due-soon:${stage.stageId}`,
        kind: 'stage.due-soon',
        severity: 'warning',
        title: `Скоро срок: этап ${stage.stageNumber} «${stage.stageTitle}»`,
        description: where(stage.universityName, stage.programName),
        occurredAt: (enteredWindow < now ? enteredWindow : now).toISOString(),
        target,
      })
    }
  }

  for (const change of sources.stageChanges) {
    items.push({
      id: `stage:${change.historyId}`,
      kind: 'stage.changed',
      severity: change.toStatus === 'BLOCKED' ? 'warning' : 'info',
      title: stageEventTitle(change.stageNumber, change.stageTitle, change.toStatus),
      description: withAuthor(where(change.universityName, change.programName), change.authorName),
      occurredAt: change.changedAt.toISOString(),
      target: {
        type: 'cooperation',
        id: change.cooperationId,
        cooperationId: change.cooperationId,
        stageId: change.stageId,
      },
    })
  }

  for (const change of sources.documentChanges) {
    items.push({
      id: `document:${change.historyId}`,
      kind: 'document.changed',
      severity: 'info',
      title: documentEventTitle(change.title, change.version, change.toStatus),
      description: change.universityName,
      occurredAt: change.changedAt.toISOString(),
      target: {
        type: 'document',
        id: change.documentId,
        cooperationId: change.cooperationId,
        stageId: null,
      },
    })
  }

  for (const recommendation of sources.recommendations) {
    if (
      recommendation.ruleKey === 'stage.overdue' &&
      recommendation.cooperationId !== null &&
      recommendation.stageNumber !== null &&
      overdueEvents.has(overdueEventKey(recommendation.cooperationId, recommendation.stageNumber))
    ) {
      continue
    }
    items.push({
      id: `recommendation:${recommendation.id}`,
      kind: 'recommendation',
      severity: RECOMMENDATION_SEVERITY[recommendation.priority],
      title: recommendation.title,
      description: recommendation.label,
      occurredAt: recommendation.createdAt.toISOString(),
      target: {
        type: 'recommendation',
        id: recommendation.id,
        cooperationId: recommendation.cooperationId,
        stageId: null,
      },
    })
  }

  for (const change of sources.responsibleAssignments) {
    items.push({ id: `responsible:${change.auditLogId}`, severity: 'info', ...responsibleItem(change) })
  }

  for (const assignment of sources.assignments) {
    items.push(...assignmentItems(assignment, now))
  }

  // Новые сверху; при равном времени — порядок по id, чтобы лента не «прыгала»
  // между запросами.
  items.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id))

  const withUnread: NotificationDto[] = items.map((item) => ({
    ...item,
    isUnread: since === null || new Date(item.occurredAt).getTime() > since.getTime(),
  }))

  // Просрочка — не событие, а состояние, которое ждёт действия. Время у неё —
  // истёкший срок, то есть прошлое, и при обрезке по времени свежие изменения
  // её вытеснят, а просроченных в ленте должно быть столько же, сколько в личной
  // статистике (решения 37 и 50). Поэтому в показанную часть сначала попадают
  // все просрочки, а остальное место — по времени. Порядок внутри ленты — от новых
  // к старым, как у остальной ленты.
  // Просроченное поручение (решение 207) — такое же состояние «ждёт действия».
  const isOverdueItem = (item: NotificationDto) => item.kind === 'stage.overdue' || item.kind === 'assignment.overdue'
  const overdueIds = withUnread
    .filter(isOverdueItem)
    .slice(0, limit)
    .map((item) => item.id)
  const restIds = withUnread
    .filter((item) => !isOverdueItem(item))
    .slice(0, limit - overdueIds.length)
    .map((item) => item.id)
  const shown = new Set([...overdueIds, ...restIds])

  // Счётчик — по всей ленте, а не по показанной части: значок на колокольчике
  // не должен врать из-за того, что выпадающий список короче.
  return {
    items: withUnread.filter((item) => shown.has(item.id)),
    unreadCount: withUnread.filter((item) => item.isUnread).length,
    generatedAt: now.toISOString(),
  }
}
