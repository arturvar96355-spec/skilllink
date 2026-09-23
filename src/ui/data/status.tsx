import {
  COOPERATION_STATUS_LABELS,
  DOCUMENT_STATUS_LABELS,
  PROGRAM_STATUS_LABELS,
  RECOMMENDATION_PRIORITY_LABELS,
  RECOMMENDATION_STATUS_LABELS,
  STAGE_STATUS_LABELS,
  UNIVERSITY_STATUS_LABELS,
  type CooperationStatus,
  type DocumentStatus,
  type ProgramStatus,
  type RecommendationPriority,
  type RecommendationStatus,
  type StageStatus,
  type UniversityStatus,
} from '@/shared/contracts'
import { Badge, type BadgeTone } from '../primitives/Badge'
import { deadlineBadgeText } from '../lib/format'

/**
 * Значки статусов.
 *
 * Подписи берутся из общего словаря контрактов, а не пишутся в вёрстке:
 * иначе надпись на экране разойдётся с тем же статусом в обоснованиях
 * рекомендаций и в выгрузке, которые собирает сервер.
 *
 * Соответствие «статус → цвет» задано здесь один раз, чтобы «Просрочен»
 * на разных страницах не оказался где-то красным, а где-то серым.
 */

const UNIVERSITY_TONES: Record<UniversityStatus, BadgeTone> = {
  NEW: 'info',
  IN_PROGRESS: 'accent',
  ACTIVE: 'success',
  PAUSED: 'warning',
  ARCHIVED: 'neutral',
}

const PROGRAM_TONES: Record<ProgramStatus, BadgeTone> = {
  DRAFT: 'neutral',
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  ARCHIVED: 'neutral',
}

const COOPERATION_TONES: Record<CooperationStatus, BadgeTone> = {
  DRAFT: 'neutral',
  ACTIVE: 'success',
  PAUSED: 'warning',
  COMPLETED: 'accent',
  CANCELLED: 'neutral',
}

const STAGE_TONES: Record<StageStatus, BadgeTone> = {
  NOT_STARTED: 'neutral',
  IN_PROGRESS: 'accent',
  BLOCKED: 'danger',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
}

const DOCUMENT_TONES: Record<DocumentStatus, BadgeTone> = {
  DRAFT: 'neutral',
  REVIEW: 'warning',
  APPROVED: 'accent',
  SIGNED: 'success',
  REJECTED: 'danger',
  ARCHIVED: 'neutral',
}

const PRIORITY_TONES: Record<RecommendationPriority, BadgeTone> = {
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'warning',
  CRITICAL: 'danger',
}

const RECOMMENDATION_TONES: Record<RecommendationStatus, BadgeTone> = {
  NEW: 'accent',
  IN_PROGRESS: 'info',
  ACCEPTED: 'success',
  DISMISSED: 'neutral',
  DONE: 'success',
}

export function UniversityStatusBadge({ status }: { status: UniversityStatus }) {
  return (
    <Badge tone={UNIVERSITY_TONES[status]} withDot>
      {UNIVERSITY_STATUS_LABELS[status]}
    </Badge>
  )
}

export function ProgramStatusBadge({ status }: { status: ProgramStatus }) {
  return (
    <Badge tone={PROGRAM_TONES[status]} withDot>
      {PROGRAM_STATUS_LABELS[status]}
    </Badge>
  )
}

export function CooperationStatusBadge({ status }: { status: CooperationStatus }) {
  return (
    <Badge tone={COOPERATION_TONES[status]} withDot>
      {COOPERATION_STATUS_LABELS[status]}
    </Badge>
  )
}

export function StageStatusBadge({ status }: { status: StageStatus }) {
  return (
    <Badge tone={STAGE_TONES[status]} withDot>
      {STAGE_STATUS_LABELS[status]}
    </Badge>
  )
}

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <Badge tone={DOCUMENT_TONES[status]} withDot>
      {DOCUMENT_STATUS_LABELS[status]}
    </Badge>
  )
}

export function PriorityBadge({ priority }: { priority: RecommendationPriority }) {
  return (
    <Badge tone={PRIORITY_TONES[priority]} withDot>
      {RECOMMENDATION_PRIORITY_LABELS[priority]}
    </Badge>
  )
}

export function RecommendationStatusBadge({ status }: { status: RecommendationStatus }) {
  return <Badge tone={RECOMMENDATION_TONES[status]}>{RECOMMENDATION_STATUS_LABELS[status]}</Badge>
}

/**
 * Срок этапа: просрочен, вот-вот истечёт или в порядке.
 *
 * В строке таблицы значок короткий — «−57 дн.»: полная фраза занимала полстолбца
 * и выталкивала название этапа. Полный текст остаётся в подсказке.
 */
export function DeadlineBadge({
  isOverdue,
  isDueSoon,
  daysToDeadline,
  compact = false,
}: {
  isOverdue: boolean
  isDueSoon: boolean
  daysToDeadline: number | null
  compact?: boolean
}) {
  if (isOverdue) {
    return (
      <Badge tone="danger" withDot title={deadlineBadgeText('overdue', daysToDeadline)}>
        {deadlineBadgeText('overdue', daysToDeadline, compact)}
      </Badge>
    )
  }
  if (isDueSoon) {
    return (
      <Badge tone="warning" withDot title={deadlineBadgeText('dueSoon', daysToDeadline)}>
        {deadlineBadgeText('dueSoon', daysToDeadline, compact)}
      </Badge>
    )
  }
  return null
}
