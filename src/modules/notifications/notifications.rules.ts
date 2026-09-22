import { DEADLINE_WARNING_DAYS } from '@/shared/config/analytics.config'
import type { DocumentStatus, RecommendationPriority, StageStatus } from '@/shared/contracts/enums'
import type {
  NotificationDto,
  NotificationFeedDto,
  NotificationSeverity,
} from '@/shared/contracts/notification'
import { documentEventTitle, stageEventTitle } from '@/modules/audit/audit.rules'
import { isDueSoon, isOverdue } from '@/modules/workflow/workflow.rules'

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
  title: string
  /** Имя объекта: «СПбГУТ — Программная инженерия». Заголовок его не содержит. */
  label: string
  priority: RecommendationPriority
  createdAt: Date
  cooperationId: string | null
}

export interface FeedSources {
  deadlines: StageDeadlineSource[]
  stageChanges: StageChangeSource[]
  documentChanges: DocumentChangeSource[]
  recommendations: RecommendationSource[]
}

function where(universityName: string, programName: string): string {
  return `${universityName} — ${programName}`
}

function withAuthor(text: string, authorName: string | null): string {
  return authorName ? `${text} · ${authorName}` : text
}

const RECOMMENDATION_SEVERITY: Record<RecommendationPriority, NotificationSeverity> = {
  CRITICAL: 'critical',
  HIGH: 'warning',
  MEDIUM: 'info',
  LOW: 'info',
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

  for (const stage of sources.deadlines) {
    const target = {
      type: 'cooperation' as const,
      id: stage.cooperationId,
      cooperationId: stage.cooperationId,
      stageId: stage.stageId,
    }
    if (isOverdue(stage.deadline, stage.status, now)) {
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

  // Новые сверху; при равном времени — порядок по id, чтобы лента не «прыгала»
  // между запросами.
  items.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id))

  const withUnread: NotificationDto[] = items.map((item) => ({
    ...item,
    isUnread: since === null || new Date(item.occurredAt).getTime() > since.getTime(),
  }))

  // Счётчик — по всей ленте, а не по показанной части: значок на колокольчике
  // не должен врать из-за того, что выпадающий список короче.
  return {
    items: withUnread.slice(0, limit),
    unreadCount: withUnread.filter((item) => item.isUnread).length,
    generatedAt: now.toISOString(),
  }
}
