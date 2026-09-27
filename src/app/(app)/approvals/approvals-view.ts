import {
  APPROVAL_ACTION_LABELS,
  USER_ROLE_LABELS,
  type ApprovalAction,
  type ApprovalDto,
  type ApprovalScope,
} from '@/shared/contracts'
import type { QueueTone, QueueValueTone } from '@/ui/data/queue-row'
import { formatPersonShort, pluralize } from '@/ui/lib/format'

/**
 * Чистая логика экрана «Согласования» (решение 218): без React, чтобы подписи,
 * тон строки, следующий шаг и тело выполнения проверялись тестом.
 *
 * «Четыре глаза» (решение 133): опасную операцию просит один администратор,
 * согласует другой, выполняет снова первый — одобрение срабатывает один раз.
 */

export const APPROVAL_TABS: ReadonlyArray<{ key: ApprovalScope; label: string }> = [
  { key: 'awaiting', label: 'Ждут моего решения' },
  { key: 'mine', label: 'Мои запросы' },
  { key: 'history', label: 'История' },
]

export function isApprovalScope(value: string | null): value is ApprovalScope {
  return value === 'awaiting' || value === 'mine' || value === 'history'
}

/** Статус словами — с точки зрения того, что будет дальше, а не как хранится. */
export const APPROVAL_STATE_TEXT: Record<ApprovalDto['status'], string> = {
  REQUESTED: 'ждёт решения',
  APPROVED: 'согласовано — осталось выполнить',
  REJECTED: 'отклонено',
  CONSUMED: 'выполнено',
  EXPIRED: 'истёк срок',
}

type Viewer = { id: string; isReviewer: boolean }

/** «Назначить администратором: Орлов М. Ю.» — что и над кем, одной строкой. */
export function approvalTitle(item: Pick<ApprovalDto, 'action' | 'target'>): string {
  const who = item.target ? formatPersonShort(item.target.fullName) : 'пользователь удалён'
  return `${APPROVAL_ACTION_LABELS[item.action]}: ${who}`
}

/** Подробнее о цели: «Орлов Михаил Юрьевич, аналитик» или «…, заблокирован». */
export function approvalTargetText(item: Pick<ApprovalDto, 'target'>): string {
  if (!item.target) return 'Пользователя больше нет в справочнике'
  const role = USER_ROLE_LABELS[item.target.role].toLowerCase()
  return `${item.target.fullName}, ${role}${item.target.isActive ? '' : ', заблокирован'}`
}

const HOUR = 3600_000
/** Меньше стольких часов до конца срока — значение справа становится красным. */
export const EXPIRY_WARNING_HOURS = 3

/** «ещё 18 ч», «ещё 40 мин» — сколько осталось до конца срока запроса. */
export function timeLeftText(expiresAt: string, now: number): string {
  const left = new Date(expiresAt).getTime() - now
  if (left <= 0) return 'срок вышел'
  if (left < HOUR) {
    const minutes = Math.max(1, Math.floor(left / 60_000))
    return `ещё ${minutes} мин`
  }
  const hours = Math.floor(left / HOUR)
  if (hours < 48) return `ещё ${hours} ч`
  const days = Math.floor(hours / 24)
  return `ещё ${days} ${pluralize(days, ['день', 'дня', 'дней'])}`
}

/** Ждёт действия и срок ещё идёт. */
function isLive(item: Pick<ApprovalDto, 'status' | 'expiresAt'>, now: number): boolean {
  return (item.status === 'REQUESTED' || item.status === 'APPROVED') && new Date(item.expiresAt).getTime() > now
}

/**
 * Полоска слева (решение 206): фиолетовая — ждёт чьего-то действия, бледная — дело
 * решено. Красный — только когда срок почти вышел и решать нужно сейчас.
 */
export function approvalTone(item: Pick<ApprovalDto, 'status' | 'expiresAt'>, now: number): QueueTone {
  if (!isLive(item, now)) return 'accent-faint'
  const left = new Date(item.expiresAt).getTime() - now
  return left < EXPIRY_WARNING_HOURS * HOUR ? 'critical' : 'accent'
}

/** Значение справа: остаток срока у живых, итог — у решённых. */
export function approvalValue(
  item: Pick<ApprovalDto, 'status' | 'expiresAt'>,
  now: number,
): { text: string; tone: QueueValueTone } {
  if (isLive(item, now)) {
    const left = new Date(item.expiresAt).getTime() - now
    return { text: timeLeftText(item.expiresAt, now), tone: left < EXPIRY_WARNING_HOURS * HOUR ? 'danger' : 'muted' }
  }
  const status = item.status === 'REQUESTED' || item.status === 'APPROVED' ? 'EXPIRED' : item.status
  return { text: APPROVAL_STATE_TEXT[status], tone: 'muted' }
}

/**
 * Что может сделать текущий администратор с запросом:
 * - `approve` — чужой ждущий: «Согласовать» или «Отклонить»;
 * - `run` — свой согласованный: «Выполнить» (одобрение сработает один раз);
 * - `withdraw` — свой ждущий: согласовать сам не может, может только отозвать;
 * - `null` — решено, истекло или это учётка эксперта (только чтение).
 */
export type ApprovalStep = 'approve' | 'run' | 'withdraw' | null

export function approvalStep(item: ApprovalDto, viewer: Viewer, now: number): ApprovalStep {
  if (viewer.isReviewer || !isLive(item, now)) return null
  const mine = item.requestedBy.id === viewer.id
  if (item.status === 'REQUESTED') {
    if (item.canApprove) return 'approve'
    return mine ? 'withdraw' : null
  }
  return mine && item.target ? 'run' : null
}

/** Какой вкладке принадлежит запрос — для перехода из колокольчика `?open=`. */
export function approvalTabOf(item: ApprovalDto, viewerId: string, now: number): ApprovalScope {
  if (item.status === 'REQUESTED' && item.requestedBy.id !== viewerId && new Date(item.expiresAt).getTime() > now) {
    return 'awaiting'
  }
  if (item.requestedBy.id === viewerId) return 'mine'
  return 'history'
}

/**
 * Тело `PATCH /api/users/:id` для выполнения согласованной операции: та же операция
 * с теми же параметрами, что одобрена, плюс `approvalId` — иначе сервер не примет.
 */
export function executionBody(action: ApprovalAction, approvalId: string): Record<string, unknown> {
  return action === 'user.grant_admin' ? { role: 'ADMIN', approvalId } : { isActive: false, approvalId }
}

/** Что покажет сообщение об успехе выполнения. */
export function executionDoneText(item: Pick<ApprovalDto, 'action' | 'target'>): string {
  const who = item.target ? formatPersonShort(item.target.fullName) : 'Пользователь'
  return item.action === 'user.grant_admin'
    ? `Выполнено: ${who} теперь администратор`
    : `Выполнено: ${who} заблокирован — вход и открытые сессии больше не работают`
}

/** Кто решил — строкой без рода: «Согласовано: Демидова А. С.». */
export function decisionText(item: Pick<ApprovalDto, 'status' | 'approvedBy' | 'rejectedBy'>): string | null {
  if (item.rejectedBy) return `Отклонено: ${formatPersonShort(item.rejectedBy.fullName)}`
  if (item.approvedBy) return `Согласовано: ${formatPersonShort(item.approvedBy.fullName)}`
  if (item.status === 'EXPIRED') return 'Никто не решил до конца срока'
  return null
}

/** Признак «нужно второе подтверждение» в ответе 403 (решение 133): `details.approvalRequired`. */
export function approvalRequiredAction(details: unknown): ApprovalAction | null {
  if (!details || typeof details !== 'object') return null
  const record = details as Record<string, unknown>
  if (record.approvalRequired !== true) return null
  return record.action === 'user.grant_admin' || record.action === 'user.block_admin' ? record.action : null
}

/** Уже отправленный свой запрос на ту же операцию над тем же человеком — чтобы не плодить дубли. */
export function findOwnRequest(
  items: readonly ApprovalDto[],
  action: ApprovalAction,
  userId: string,
  viewerId: string,
  now: number,
): ApprovalDto | null {
  return (
    items.find(
      (item) =>
        item.action === action &&
        item.payload.userId === userId &&
        item.requestedBy.id === viewerId &&
        isLive(item, now),
    ) ?? null
  )
}

/** Группа очереди: ждёт моего действия, ждёт чужого решения, уже решено. */
export type ApprovalGroupKey = 'act' | 'wait' | 'done'

export const APPROVAL_GROUP_LABELS: Record<ApprovalGroupKey, string> = {
  act: 'Нужно ваше действие',
  wait: 'Ждут решения',
  done: 'Решено или истекло',
}

/**
 * Строки вкладки группами (решение 206): сверху то, что ждёт именно меня, ниже —
 * то, что ждёт других, внизу — решённое. Пустые группы не показываются, порядок
 * внутри группы — как пришёл с сервера (новые сверху).
 */
export function groupApprovals(
  items: readonly ApprovalDto[],
  viewer: Viewer,
  now: number,
): Array<{ key: ApprovalGroupKey; label: string; items: ApprovalDto[] }> {
  const groups: Record<ApprovalGroupKey, ApprovalDto[]> = { act: [], wait: [], done: [] }
  for (const item of items) {
    const step = approvalStep(item, viewer, now)
    const key: ApprovalGroupKey = step === 'approve' || step === 'run' ? 'act' : isLive(item, now) ? 'wait' : 'done'
    groups[key].push(item)
  }
  return (['act', 'wait', 'done'] as const)
    .filter((key) => groups[key].length > 0)
    .map((key) => ({ key, label: APPROVAL_GROUP_LABELS[key], items: groups[key] }))
}
