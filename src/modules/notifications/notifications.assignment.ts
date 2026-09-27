import type { StageStatus } from '@/shared/contracts/enums'
import { cooperationHref, universityHref } from '@/ui/lib/links'
import { countWithNoun } from '@/shared/utils/text'
import { formatDay } from '@/modules/ai-assist/ai-assist.rules'
import { acceptStageText } from '@/modules/telegram/telegram.actions'
import { findCurrentStage, isAutoManaged, isOverdue } from '@/modules/workflow/workflow.rules'
import { ACTION_TEXTS, type ChannelMessage, type MessageAction } from '@/modules/notify-channels/notify-channels.types'

/**
 * Уведомление «Вас назначили ответственным» в канал пользователя — Telegram, MAX, VK
 * (решение 205, замечание продукт-менеджера S4). Чистые правила: кому слать и что.
 *
 * В тексте — только названия вуза, программы, этапа и срок. Ни ФИО того, кто назначил,
 * ни почт, ни телефонов: канал — иностранный сервис (docs/PRIVACY.md), как и у сводки
 * (решение 102) и письма вуза (решение 183).
 */

/** За что назначили: связка (PATCH /api/cooperations/:id), этап, вуз. */
export type AssignmentScope = 'cooperation' | 'stage' | 'university'

/** Смена ответственного, как её видит сервис после успешной записи. */
export interface ResponsibleChange {
  scope: AssignmentScope
  objectId: string
  /** Новый ответственный; null — ответственного сняли. */
  responsibleId: string | null
  /** Кто был до записи (прочитан в той же проверке, что и запись). */
  previousResponsibleId: string | null
  /** Кто назначил. */
  actorId: string
}

/**
 * Слать ли уведомление: ответственный назначен, он новый и назначил его кто-то другой.
 * Повторный PATCH с тем же ответственным — не событие; себя назначать уведомлением незачем.
 */
export function shouldNotifyAssignment(
  change: ResponsibleChange,
): change is ResponsibleChange & { responsibleId: string } {
  return (
    change.responsibleId !== null &&
    change.responsibleId !== change.previousResponsibleId &&
    change.responsibleId !== change.actorId
  )
}

export interface AssignmentStageRef {
  stageId: string
  stageNumber: number
  title: string
  status: StageStatus
  deadline: Date | null
}

export type AssignmentContext =
  | {
      scope: 'cooperation'
      cooperationId: string
      universityName: string
      programName: string
      /** Все этапы связки — текущий считается тем же правилом, что в карточке (`findCurrentStage`). */
      stages: AssignmentStageRef[]
    }
  | {
      scope: 'stage'
      cooperationId: string
      universityName: string
      programName: string
      stage: AssignmentStageRef
    }
  | {
      scope: 'university'
      universityId: string
      universityName: string
      activeCooperations: number
    }

function deadlineText(stage: AssignmentStageRef, now: Date): string {
  const day = formatDay(stage.deadline?.toISOString() ?? null)
  if (!day) return 'срок не задан'
  return isOverdue(stage.deadline, stage.status, now) ? `срок ${day} — просрочен` : `срок ${day}`
}

/** «Принял» — только у этапа, который ещё в работе и меняется руками (как в `acceptStage`). */
function acceptable(stage: AssignmentStageRef | null): stage is AssignmentStageRef {
  return (
    stage !== null &&
    stage.status !== 'COMPLETED' &&
    stage.status !== 'CANCELLED' &&
    !isAutoManaged(stage.stageNumber)
  )
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

function absolute(baseUrl: string | null, path: string): string | null {
  return baseUrl ? `${baseUrl.replace(/\/+$/, '')}${path}` : null
}

/**
 * Строка кнопок (решение 200): «Открыть …» — если известен адрес стенда, и
 * «✓ Принял, беру в работу» для этапа. Без адреса стенда «Принял» сама называет этап.
 */
function actionRow(
  open: { text: string; url: string | null },
  accept: { stage: AssignmentStageRef; universityName: string } | null,
): MessageAction[][] {
  const row: MessageAction[] = []
  if (open.url) row.push({ kind: 'open', text: open.text, url: open.url })
  if (accept) {
    row.push({
      kind: 'accept',
      text: open.url ? ACTION_TEXTS.accept : acceptStageText(accept.stage.stageNumber, accept.universityName),
      target: { type: 'stage', id: accept.stage.stageId },
    })
  }
  return row.length > 0 ? [row] : []
}

/** Текст и кнопки уведомления о назначении. */
export function buildAssignmentNotice(
  context: AssignmentContext,
  options: { now: Date; baseUrl: string | null },
): ChannelMessage {
  const { now, baseUrl } = options

  switch (context.scope) {
    case 'cooperation': {
      const where = `${context.universityName} — ${context.programName}`
      const current = findCurrentStage(context.stages)
      const stageLine = current
        ? `Текущий этап ${current.stageNumber} «${current.title}», ${deadlineText(current, now)}.`
        : 'Все этапы связки закрыты.'
      return {
        text: `Вас назначили ответственным за связку: ${where}.\n${stageLine}`,
        actions: actionRow(
          {
            text: ACTION_TEXTS.openCooperation,
            url: absolute(baseUrl, cooperationHref(context.cooperationId, current?.stageId)),
          },
          acceptable(current) ? { stage: current, universityName: context.universityName } : null,
        ),
      }
    }
    case 'stage': {
      const { stage } = context
      return {
        text:
          `Вас назначили ответственным за этап ${stage.stageNumber} «${stage.title}»: ` +
          `${context.universityName} — ${context.programName}.\n` +
          `${capitalize(deadlineText(stage, now))}.`,
        actions: actionRow(
          { text: ACTION_TEXTS.openStage, url: absolute(baseUrl, cooperationHref(context.cooperationId, stage.stageId)) },
          acceptable(stage) ? { stage, universityName: context.universityName } : null,
        ),
      }
    }
    case 'university': {
      const inWork =
        context.activeCooperations > 0
          ? `В работе ${countWithNoun(context.activeCooperations, ['связка', 'связки', 'связок'])}.`
          : 'Связок в работе пока нет.'
      return {
        text: `Вас назначили ответственным за вуз: ${context.universityName}.\n${inWork}`,
        actions: actionRow(
          { text: ACTION_TEXTS.openUniversity, url: absolute(baseUrl, universityHref(context.universityId)) },
          null,
        ),
      }
    }
  }
}
