import {
  COOPERATION_STATUS_LABELS,
  DOCUMENT_STATUS_LABELS,
  INBOUND_LETTER_STATUS_LABELS,
  PROGRAM_STATUS_LABELS,
  RECOMMENDATION_PRIORITY_LABELS,
  RECOMMENDATION_STATUS_LABELS,
  STAGE_STATUS_LABELS,
  TRANSFER_STATUS_LABELS,
  UNIVERSITY_STATUS_LABELS,
  type CooperationStatus,
  type DocumentStatus,
  type InboundLetterStatus,
  type ProgramStatus,
  type RecommendationPriority,
  type RecommendationStatus,
  type StageStatus,
  type TransferStatus,
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

/** Статус передачи ПО вузу — «Каталог по ТЗ» (решение 145/150). */
const TRANSFER_TONES: Record<TransferStatus, BadgeTone> = {
  NOT_TRANSFERRED: 'neutral',
  IN_PROGRESS: 'info',
  TRANSFERRED: 'success',
  REVOKED: 'danger',
}

/** Обращение из письма вуза (решение 170/171). */
const INBOUND_LETTER_TONES: Record<InboundLetterStatus, BadgeTone> = {
  NEW: 'info',
  ANALYZED: 'accent',
  CONFIRMED: 'success',
  CORRECTED: 'warning',
  DISMISSED: 'neutral',
}

/**
 * Подсказки к бирке (решение 182, п. 1): бирка не ведёт никуда по щелчку —
 * объяснение статуса даёт всплывающая подсказка браузера, а не сама форма
 * (border+заливка+пилюля), которую раньше принимали за кнопку.
 */
const UNIVERSITY_STATUS_HINTS: Record<UniversityStatus, string> = {
  NEW: 'Новый вуз: сотрудничество ещё не начато.',
  IN_PROGRESS: 'Сотрудничество начато: связки и этапы уже заведены.',
  ACTIVE: 'Активное сотрудничество, обучение идёт.',
  PAUSED: 'Сотрудничество приостановлено.',
  ARCHIVED: 'Вуз в архиве: сотрудничество завершено или отменено.',
}

const PROGRAM_STATUS_HINTS: Record<ProgramStatus, string> = {
  DRAFT: 'Черновик: программа ещё не участвует в наборе.',
  ACTIVE: 'Программа действует и участвует в наборе.',
  SUSPENDED: 'Набор на программу приостановлен.',
  ARCHIVED: 'Программа в архиве.',
}

const COOPERATION_STATUS_HINTS: Record<CooperationStatus, string> = {
  DRAFT: 'Черновик связки: работа по этапам ещё не началась.',
  ACTIVE: 'Связка активна, этапы идут.',
  PAUSED: 'Связка приостановлена.',
  COMPLETED: 'Связка завершена.',
  CANCELLED: 'Связка отменена.',
}

const STAGE_STATUS_HINTS: Record<StageStatus, string> = {
  NOT_STARTED: 'Этап ещё не начат.',
  IN_PROGRESS: 'Этап в работе.',
  BLOCKED: 'Этап заблокирован — причина указана ниже.',
  COMPLETED: 'Этап завершён.',
  CANCELLED: 'Этап отменён.',
}

const DOCUMENT_STATUS_HINTS: Record<DocumentStatus, string> = {
  DRAFT: 'Черновик документа.',
  REVIEW: 'Документ на согласовании.',
  APPROVED: 'Документ согласован.',
  SIGNED: 'Документ подписан.',
  REJECTED: 'Документ отклонён.',
  ARCHIVED: 'Документ в архиве.',
}

const PRIORITY_HINTS: Record<RecommendationPriority, string> = {
  LOW: 'Низкий приоритет: можно заняться позже.',
  MEDIUM: 'Средний приоритет.',
  HIGH: 'Высокий приоритет: стоит заняться в первую очередь.',
  CRITICAL: 'Критично: требует внимания незамедлительно.',
}

const RECOMMENDATION_STATUS_HINTS: Record<RecommendationStatus, string> = {
  NEW: 'Новая рекомендация, ещё не рассмотрена.',
  IN_PROGRESS: 'Рекомендация в работе.',
  ACCEPTED: 'Рекомендация принята.',
  DISMISSED: 'Рекомендация отклонена.',
  DONE: 'Рекомендация выполнена.',
}

const TRANSFER_STATUS_HINTS: Record<TransferStatus, string> = {
  NOT_TRANSFERRED: 'Программное обеспечение вузу ещё не передано.',
  IN_PROGRESS: 'Передача программного обеспечения идёт.',
  TRANSFERRED: 'Программное обеспечение передано вузу.',
  REVOKED: 'Передача программного обеспечения отозвана.',
}

const INBOUND_LETTER_STATUS_HINTS: Record<InboundLetterStatus, string> = {
  NEW: 'Письмо ещё не обработано.',
  ANALYZED: 'Письмо разобрано автоматически.',
  CONFIRMED: 'Данные письма подтверждены.',
  CORRECTED: 'Данные письма исправлены вручную.',
  DISMISSED: 'Письмо отклонено.',
}

export function UniversityStatusBadge({ status }: { status: UniversityStatus }) {
  return (
    <Badge tone={UNIVERSITY_TONES[status]} withDot title={UNIVERSITY_STATUS_HINTS[status]}>
      {UNIVERSITY_STATUS_LABELS[status]}
    </Badge>
  )
}

export function ProgramStatusBadge({ status }: { status: ProgramStatus }) {
  return (
    <Badge tone={PROGRAM_TONES[status]} withDot title={PROGRAM_STATUS_HINTS[status]}>
      {PROGRAM_STATUS_LABELS[status]}
    </Badge>
  )
}

export function CooperationStatusBadge({ status }: { status: CooperationStatus }) {
  return (
    <Badge tone={COOPERATION_TONES[status]} withDot title={COOPERATION_STATUS_HINTS[status]}>
      {COOPERATION_STATUS_LABELS[status]}
    </Badge>
  )
}

export function StageStatusBadge({ status }: { status: StageStatus }) {
  return (
    <Badge tone={STAGE_TONES[status]} withDot title={STAGE_STATUS_HINTS[status]}>
      {STAGE_STATUS_LABELS[status]}
    </Badge>
  )
}

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <Badge tone={DOCUMENT_TONES[status]} withDot title={DOCUMENT_STATUS_HINTS[status]}>
      {DOCUMENT_STATUS_LABELS[status]}
    </Badge>
  )
}

export function PriorityBadge({ priority }: { priority: RecommendationPriority }) {
  return (
    <Badge tone={PRIORITY_TONES[priority]} withDot title={PRIORITY_HINTS[priority]}>
      {RECOMMENDATION_PRIORITY_LABELS[priority]}
    </Badge>
  )
}

export function RecommendationStatusBadge({ status }: { status: RecommendationStatus }) {
  return (
    <Badge tone={RECOMMENDATION_TONES[status]} withDot title={RECOMMENDATION_STATUS_HINTS[status]}>
      {RECOMMENDATION_STATUS_LABELS[status]}
    </Badge>
  )
}

export function TransferStatusBadge({ status }: { status: TransferStatus }) {
  return (
    <Badge tone={TRANSFER_TONES[status]} withDot title={TRANSFER_STATUS_HINTS[status]}>
      {TRANSFER_STATUS_LABELS[status]}
    </Badge>
  )
}

export function InboundLetterStatusBadge({ status }: { status: InboundLetterStatus }) {
  return (
    <Badge tone={INBOUND_LETTER_TONES[status]} withDot title={INBOUND_LETTER_STATUS_HINTS[status]}>
      {INBOUND_LETTER_STATUS_LABELS[status]}
    </Badge>
  )
}

/** Подсказка к пометке «план сдвинут»: дата в прошлом на не начатом этапе — не ошибка. */
const PLAN_SHIFTED_HINT =
  'Срок этапа прошёл, а этап ещё не начат: план сдвинулся из-за этапов до него. Это не просрочка.'

/**
 * Срок этапа: просрочен, план сдвинут, вот-вот истечёт или в порядке.
 *
 * В строке таблицы значок короткий — «−57 дн.»: полная фраза занимала полстолбца
 * и выталкивала название этапа. Полный текст остаётся в подсказке.
 */
export function DeadlineBadge({
  isOverdue,
  isPlanShifted = false,
  isDueSoon,
  daysToDeadline,
  compact = false,
}: {
  isOverdue: boolean
  isPlanShifted?: boolean
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
  if (isPlanShifted) {
    return (
      <Badge tone="neutral" title={PLAN_SHIFTED_HINT}>
        план сдвинут
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
