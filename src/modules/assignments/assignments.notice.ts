import type { AssignmentPriority } from '@/shared/contracts/enums'
import { assignmentHref } from '@/ui/lib/links'
import { ACTION_TEXTS, type ChannelMessage } from '@/modules/notify-channels/notify-channels.types'

/**
 * Сообщение «Вам поручение» в мессенджер исполнителя — Telegram, MAX, VK (решение 207).
 *
 * Канал — иностранный сервис (docs/PRIVACY.md), поэтому в сообщении нет ни текста
 * поручения (он свободный — в нём бывают ФИО и телефоны контактов вуза), ни ФИО
 * того, кто поручил: только название вуза, срок и важность. Сам текст — по кнопке
 * «Открыть поручение», внутри SkillLink после входа. Тот же приём, что у уведомления
 * о назначении ответственным (решение 205) и сводки (решение 102).
 */

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'] as const

/** «02.10, пятница» — из календарной даты `ГГГГ-ММ-ДД`, без часового пояса. */
export function formatDueDay(dueDate: string): string {
  const [year, month, day] = dueDate.split('-').map(Number) as [number, number, number]
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}, ${weekday}`
}

export interface AssignmentNoticeContext {
  assignmentId: string
  dueDate: string
  priority: AssignmentPriority
  /** Краткое название вуза (или полное, если краткого нет); `null` — поручение без вуза. */
  universityName: string | null
}

export function buildAssignmentMessage(
  context: AssignmentNoticeContext,
  options: { baseUrl: string | null },
): ChannelMessage {
  const head = context.priority === 'HIGH' ? 'Вам новое поручение — важное.' : 'Вам новое поручение.'
  const facts = [context.universityName ? `Вуз: ${context.universityName}.` : null, `Срок: ${formatDueDay(context.dueDate)}.`]
    .filter(Boolean)
    .join(' ')
  const url = options.baseUrl ? `${options.baseUrl.replace(/\/+$/, '')}${assignmentHref(context.assignmentId)}` : null
  return {
    text: `${head}\n${facts}\nЧто сделать — в SkillLink, «Мои поручения» в личном кабинете.`,
    actions: url ? [[{ kind: 'open', text: ACTION_TEXTS.openAssignment, url }]] : [],
  }
}
