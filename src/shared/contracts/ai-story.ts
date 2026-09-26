import { AI_DRAFT_SOURCE_LABELS, type AiDraftSource, type AiFallbackReason } from './ai-assist'
import type { MeetingFormat, StageStatus } from './enums'
import type { MeetingDto } from './meeting'
import type { WorkflowStageDto } from './workflow'

/**
 * Безопасный ИИ-помощник на карточке вуза и связки (решение 138).
 *
 * Три уровня, и на каждом решает человек:
 * 1. **Подсказка** — «История сотрудничества» и «Что мешает»: только чтение.
 * 2. **Проект** — «Предложить план»: проект встречи или задачи, в базу ничего не пишется.
 * 3. **Применение** — человек нажимает «Сохранить», и проект сохраняет штатный сервис
 *    с обычными проверками прав и данных.
 *
 * Числа и даты считает код. Модель, если она подключена, только переформулирует
 * готовые факты; ответ с числом, которого нет в фактах, отбрасывается.
 */

/** Кто сформулировал текст: модель или шаблон без модели. */
export const AI_STORY_SOURCES = ['model', 'template'] as const
export type AiStorySource = (typeof AI_STORY_SOURCES)[number]

// ─────────────────────────── Что мешает ─────────────────────────────────────

/**
 * Что мешает перейти к следующему этапу — коды в порядке важности:
 * первый найденный — главное препятствие.
 *
 * - `COOPERATION_CLOSED` — связка завершена или отменена, этапы заморожены;
 * - `COOPERATION_PAUSED` — связка приостановлена;
 * - `STAGE_BLOCKED` — текущий этап заблокирован;
 * - `CONTROL_POINT` — текущий этап заперт контрольной точкой (решение 78);
 * - `PRODUCT_NOT_SELECTED` — дошли до оформления, а IT-продукт не выбран;
 * - `DOCUMENTS_NOT_SIGNED` — этап подписания, а подписанных документов нет;
 * - `UNIVERSITY_ITEM_PENDING` — вуз не отметил свой обязательный пункт (решение 103);
 * - `REQUIRED_TASKS_OPEN` — не отмечены обязательные пункты чек-листа;
 * - `STAGE_NOT_STARTED` — текущий этап ещё не начат;
 * - `RESULT_MISSING` — пункты отмечены, но не записан результат этапа;
 * - `NEXT_CONTROL_POINT` — следующий этап — контрольная точка, и перед ней
 *   не закрыты ещё и другие этапы.
 */
export const BLOCKER_CODES = [
  'COOPERATION_CLOSED',
  'COOPERATION_PAUSED',
  'STAGE_BLOCKED',
  'CONTROL_POINT',
  'PRODUCT_NOT_SELECTED',
  'DOCUMENTS_NOT_SIGNED',
  'UNIVERSITY_ITEM_PENDING',
  'REQUIRED_TASKS_OPEN',
  'STAGE_NOT_STARTED',
  'RESULT_MISSING',
  'NEXT_CONTROL_POINT',
] as const
export type BlockerCode = (typeof BLOCKER_CODES)[number]

export const BLOCKER_CODE_LABELS: Record<BlockerCode, string> = {
  COOPERATION_CLOSED: 'Связка закрыта',
  COOPERATION_PAUSED: 'Связка приостановлена',
  STAGE_BLOCKED: 'Этап заблокирован',
  CONTROL_POINT: 'Контрольная точка',
  PRODUCT_NOT_SELECTED: 'Не выбран IT-продукт',
  DOCUMENTS_NOT_SIGNED: 'Документы не подписаны',
  UNIVERSITY_ITEM_PENDING: 'Ждём подтверждения вуза',
  REQUIRED_TASKS_OPEN: 'Не закрыты пункты чек-листа',
  STAGE_NOT_STARTED: 'Этап не начат',
  RESULT_MISSING: 'Не записан результат этапа',
  NEXT_CONTROL_POINT: 'Впереди контрольная точка',
}

export interface BlockerDto {
  code: BlockerCode
  /** Что именно мешает — одной фразой, с номерами этапов и названиями пунктов. */
  detail: string
  /** Куда перейти, чтобы это исправить: страница связки, этап, документы. */
  link: string
  /** Этап, к которому относится препятствие; null — вся связка. */
  stageNumber: number | null
}

export interface StageRefDto {
  id: string
  stageNumber: number
  title: string
  status: StageStatus
}

export interface CooperationBlockersDto {
  cooperationId: string
  /** Текущий этап — первый не закрытый (решение 5); null — все закрыты. */
  currentStage: StageRefDto | null
  /** Следующий за текущим этап — куда переходим. */
  nextStage: StageRefDto | null
  /** В порядке важности; первый — главное препятствие. Пусто — ничего не мешает. */
  blockers: BlockerDto[]
  /** На какой момент данные: самое позднее изменение связки, этапов, документов, встреч. */
  dataAsOf: string
}

// ─────────────────────────── История сотрудничества ─────────────────────────

export interface AiStoryDto {
  subject: { type: 'University' | 'Cooperation'; id: string }
  /** 3–5 предложений. */
  text: string
  source: AiStorySource
  /** Какая модель формулировала; null — шаблон. */
  provider: Exclude<AiDraftSource, 'template'> | null
  model: string | null
  /** Почему шаблон, если провайдер выбран; null — писала модель. */
  fallbackReason: AiFallbackReason | null
  /** Факты, из которых собран текст. Числа в тексте — только отсюда. */
  facts: string[]
  /** Главное препятствие (для связки — её, для вуза — самое важное по его связкам). */
  mainBlocker: BlockerDto | null
  generatedAt: string
  /** На какой момент данные — как у «Что мешает». */
  dataAsOf: string
}

/**
 * Подпись над историей: интерфейс всегда говорит, кто её составил.
 * «Составлено автоматически по данным системы» или
 * «Сформулировано ИИ (YandexGPT) по данным системы, числа сверены».
 */
export function aiStorySourceNote(story: Pick<AiStoryDto, 'source' | 'provider'>): string {
  if (story.source === 'template' || !story.provider) return 'Составлено автоматически по данным системы'
  return `Сформулировано ИИ (${AI_DRAFT_SOURCE_LABELS[story.provider]}) по данным системы, числа сверены`
}

// ─────────────────────────── Предложить план ────────────────────────────────

/**
 * - `meeting` — встреча по препятствиям: тема, повестка, дата;
 * - `task` — задача по текущему этапу: новый срок его закрытия.
 */
export const AI_PROPOSAL_KINDS = ['meeting', 'task'] as const
export type AiProposalKind = (typeof AI_PROPOSAL_KINDS)[number]

export const AI_PROPOSAL_KIND_LABELS: Record<AiProposalKind, string> = {
  meeting: 'Встреча',
  task: 'Новый срок этапа',
}

export interface MeetingProposalPayload {
  kind: 'meeting'
  topic: string
  /** Повестка — по одному пункту на препятствие и «следующий шаг». Без внутренних заметок. */
  agenda: string[]
  /** Предлагаемая дата и время, ISO 8601: ближайший рабочий день через 3–5 дней. */
  date: string
  format: MeetingFormat
  /** Ответственный за связку — ответственный за встречу. */
  responsibleId: string
  cooperationId: string
}

export interface TaskProposalPayload {
  kind: 'task'
  title: string
  stageId: string
  stageNumber: number
  stageTitle: string
  currentDeadline: string | null
  /** Новый срок этапа, ISO 8601. */
  dueDate: string
}

export type AiProposalPayload = MeetingProposalPayload | TaskProposalPayload

export interface AiProposalDto {
  proposalId: string
  kind: AiProposalKind
  cooperationId: string
  payload: AiProposalPayload
  /** Версия данных связки, на которой построен проект. Изменилась — применить нельзя (409). */
  sourceVersion: string
  createdAt: string
  /** После этого момента проект не применяется: нужно новое предложение. */
  expiresAt: string
  /** На что обратить внимание перед сохранением. */
  warnings: string[]
  source: AiStorySource
  provider: Exclude<AiDraftSource, 'template'> | null
  model: string | null
}

export interface AiProposalAppliedDto {
  proposalId: string
  kind: AiProposalKind
  /** Созданная встреча — для `meeting`. */
  meeting: MeetingDto | null
  /** Этап с новым сроком — для `task`. */
  stage: WorkflowStageDto | null
}
