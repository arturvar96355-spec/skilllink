import { assertCan } from '@/shared/auth/permissions'
import { writeAudit } from '@/shared/audit/audit'
import { AI_STORY } from '@/shared/config/ai-assist.config'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { AiDraftSource, AiFallbackReason } from '@/shared/contracts/ai-assist'
import type {
  AiProposalAppliedDto,
  AiProposalDto,
  AiProposalKind,
  AiStoryDto,
  CooperationBlockersDto,
} from '@/shared/contracts/ai-story'
import { RECOMMENDATION_SORT_MOST_IMPORTANT } from '@/shared/contracts/recommendation'
import { conflict, notFound } from '@/shared/http/errors'
import { getLlmProvider, llmFailureKind, type LlmProvider } from '@/integrations/llm'
import * as cooperationService from '@/modules/cooperation/cooperation.service'
import { isClosedStatus } from '@/modules/cooperation/cooperation.rules'
import * as meetingsService from '@/modules/meetings/meetings.service'
import * as recommendationsService from '@/modules/recommendations/recommendations.service'
import { OPEN_RECOMMENDATION_STATUSES } from '@/modules/recommendations/recommendations.rules'
import { OPEN_COOPERATION_STATUSES } from '@/shared/contracts/enums'
import * as universitiesService from '@/modules/universities/universities.service'
import * as workflowService from '@/modules/workflow/workflow.service'
import * as aiAssistRepo from './ai-assist.repo'
import { cleanModelText } from './ai-assist.rules'
import { cacheKey, readCache, takeGeneration, writeCache } from './ai-assist.limits'
import { containsContactDetails, createMasker, type Masker } from './ai-story.masking'
import { unknownNumbers } from './ai-story.numbers'
import * as repo from './ai-story.repo'
import {
  buildMeetingProposalPayload,
  buildProposalWarnings,
  buildTaskProposalPayload,
  chooseProposalKind,
  computeBlockers,
  countSentences,
  currentAndNextStage,
  latestOf,
  nextWorkingDay,
  pickMainBlocker,
  toStageRef,
  type CooperationStoryFacts,
  type MeetingsSummary,
  type UniversityCooperationBrief,
  type UniversityStoryFacts,
} from './ai-story.rules'
import { buildCooperationStoryPrompt, buildUniversityStoryPrompt, type StoryPrompt } from './ai-story.prompts'
import {
  consumeProposal,
  findProposal,
  saveProposal,
  toProposalDto,
} from './ai-story.proposals'
import type { CreateProposalInput } from './ai-story.schema'

/**
 * Безопасный ИИ-помощник на карточке вуза и связки (решение 138).
 *
 * Три уровня, и на каждом решает человек: подсказка (история, что мешает) — только
 * чтение; проект («Предложить план») — ничего не пишет; применение — сохраняет
 * штатный сервис (встреч или этапов) с его обычными проверками. Числа считает код;
 * модель, если подключена, только переформулирует уже посчитанные факты.
 */

// ─────────────────────────── Что мешает ──────────────────────────────────────

/**
 * Что мешает связке перейти к следующему этапу. Право — как у истории и сводки
 * ИИ-помощника: `ANALYTICS` (представителю вуза недоступно, решение 90).
 */
export async function getCooperationBlockers(
  user: CurrentUser,
  cooperationId: string,
): Promise<CooperationBlockersDto> {
  assertCan(user, 'ANALYTICS')
  const cooperation = await cooperationService.getById(user, cooperationId)
  const documents = await repo.findDocumentsSummary(cooperationId)

  const { current, next } = currentAndNextStage(cooperation.stages)
  const blockers = computeBlockers({ cooperation, documents })

  return {
    cooperationId,
    currentStage: current ? toStageRef(current) : null,
    nextStage: next ? toStageRef(next) : null,
    blockers,
    dataAsOf: cooperation.updatedAt,
  }
}

// ─────────────────────────── Обращение к модели ──────────────────────────────

interface ComposeStoryOutcome {
  text: string
  source: 'model' | 'template'
  provider: Exclude<AiDraftSource, 'template'> | null
  model: string | null
  fallbackReason: AiFallbackReason | null
}

interface StorySubject {
  type: 'Cooperation' | 'University'
  id: string
}

/** Журнал `ai.request` (решение 138): каждое обращение к модели, без текста запроса. */
async function logAiRequest(
  user: CurrentUser,
  subject: StorySubject,
  provider: string,
  model: string | null,
  factsChars: number,
  outcome: string,
): Promise<void> {
  await writeAudit({
    userId: user.id,
    action: 'ai.request',
    objectType: subject.type,
    objectId: subject.id,
    payload: { provider, model, factsChars, outcome },
  })
}

/**
 * Формулирует «Историю сотрудничества» по готовому промпту: кэш, лимит, модель,
 * запасной шаблон — тот же порядок, что у `ai-assist.service.compose`, но со своей
 * проверкой ответа: обратимая маскировка (решение 138) вместо безвозвратной,
 * и числа с датами в ответе обязаны найтись среди фактов (`ai-story.numbers.ts`).
 * Исключений наружу не бросает: сбой модели не становится ошибкой запроса.
 */
async function composeStory(
  prompt: StoryPrompt,
  masker: Masker,
  user: CurrentUser,
  subject: StorySubject,
  options: { provider?: LlmProvider; now?: Date } = {},
): Promise<ComposeStoryOutcome> {
  const provider = options.provider ?? getLlmProvider()
  const info = provider.info()
  const now = options.now ?? new Date()
  const factsChars = prompt.facts.join('\n').length

  const template = (reason: AiFallbackReason): ComposeStoryOutcome => ({
    text: prompt.template,
    source: 'template',
    provider: null,
    model: null,
    fallbackReason: reason,
  })

  if (prompt.facts.length === 0) return template('no-facts')
  if (info.kind === 'off') return template('disabled')
  if (!info.ready) return template('not-configured')
  const providerKind = info.kind

  const key = cacheKey(['story', providerKind, info.model ?? '', prompt.system, prompt.user])
  const cached = readCache(key, now.getTime())
  if (cached) {
    // В кэше — текст модели с метками маскировки: restore делается заново тем же
    // маскировщиком запроса (labels детерминированы теми же фактами — см. комментарий
    // в ai-story.masking.ts), поэтому кэш не путает данные одной связки с другой.
    return {
      text: masker.restore(cached.text),
      source: 'model',
      provider: cached.source,
      model: cached.model,
      fallbackReason: null,
    }
  }

  if (!takeGeneration(user.id, now.getTime())) {
    await logAiRequest(user, subject, providerKind, info.model, factsChars, 'rate-limited')
    return template('rate-limited')
  }

  try {
    const completion = await provider.generate({ system: prompt.system, user: prompt.user })
    const cleaned = cleanModelText(completion.text)

    if (cleaned === '') {
      await logAiRequest(user, subject, providerKind, completion.model, factsChars, 'empty')
      return template('empty')
    }
    // Модель могла выдумать контакт мимо меток или сослаться на метку, которой не выдавали.
    if (containsContactDetails(cleaned) || masker.unknownLabels(cleaned).length > 0) {
      await logAiRequest(user, subject, providerKind, completion.model, factsChars, 'invalid')
      return template('invalid')
    }
    const sentences = countSentences(cleaned)
    if (sentences < AI_STORY.minSentences || sentences > AI_STORY.maxSentences) {
      await logAiRequest(user, subject, providerKind, completion.model, factsChars, 'invalid')
      return template('invalid')
    }
    // Числа считает код: любое число или дата в ответе, которых нет в фактах, — повод отбросить ответ.
    if (unknownNumbers(cleaned, prompt.facts).length > 0) {
      await logAiRequest(user, subject, providerKind, completion.model, factsChars, 'invalid')
      return template('invalid')
    }

    writeCache(key, { text: cleaned, source: providerKind, model: completion.model }, now.getTime())
    await logAiRequest(user, subject, providerKind, completion.model, factsChars, 'model')
    return {
      text: masker.restore(cleaned),
      source: 'model',
      provider: providerKind,
      model: completion.model,
      fallbackReason: null,
    }
  } catch (error) {
    const failure = llmFailureKind(error)
    console.warn(`[AI] ${providerKind}: история не получена (${failure}), отдан шаблон`)
    const reason = failure === 'timeout' ? 'timeout' : failure === 'empty' ? 'empty' : 'failed'
    await logAiRequest(user, subject, providerKind, info.model, factsChars, reason)
    return template(reason)
  }
}

// ─────────────────────────── История связки ──────────────────────────────────

/** Официальные названия связки: уходят в модель как есть (защищены маскировщиком). */
function cooperationKeepNames(cooperation: {
  universityName: string
  universityShortName: string | null
  programName: string
  productName: string | null
  stages: ReadonlyArray<{ title: string }>
}): string[] {
  return [
    cooperation.universityName,
    cooperation.universityShortName ?? '',
    cooperation.programName,
    cooperation.productName ?? '',
    ...cooperation.stages.map((stage) => stage.title),
  ]
}

export async function getCooperationStory(user: CurrentUser, cooperationId: string): Promise<AiStoryDto> {
  assertCan(user, 'ANALYTICS')
  const cooperation = await cooperationService.getById(user, cooperationId)
  const now = new Date()

  const [documents, recommendations, meetings] = await Promise.all([
    repo.findDocumentsSummary(cooperationId),
    recommendationsService.list(user, {
      page: 1,
      pageSize: 1,
      cooperationId,
      status: [...OPEN_RECOMMENDATION_STATUSES],
      sort: RECOMMENDATION_SORT_MOST_IMPORTANT,
    }),
    meetingsService.list(user, { page: 1, pageSize: 1, cooperationId, sort: '-date' }),
  ])

  const { current } = currentAndNextStage(cooperation.stages)
  const blockers = computeBlockers({ cooperation, documents })
  const mainBlocker = blockers[0] ?? null
  const meetingsSummary: MeetingsSummary = { total: meetings.meta.total, lastAt: meetings.data[0]?.date ?? null }

  const facts: CooperationStoryFacts = {
    universityName: cooperation.universityName,
    universityShortName: cooperation.universityShortName,
    programName: cooperation.programName,
    productName: cooperation.productName,
    status: cooperation.status,
    current: current ? toStageRef(current) : null,
    totalStages: cooperation.progress.totalStages,
    closedStages: cooperation.progress.completedStages + cooperation.progress.cancelledStages,
    documents,
    meetings: meetingsSummary,
    openRecommendations: recommendations.meta.total,
    mainBlocker,
    classesStartAt: cooperation.classesStartAt,
  }

  const redactionContext = await aiAssistRepo.findRedactionContext([cooperation.universityId])
  const masker = createMasker(redactionContext.people, cooperationKeepNames(cooperation))
  const prompt = buildCooperationStoryPrompt(facts, masker)
  const outcome = await composeStory(prompt, masker, user, { type: 'Cooperation', id: cooperationId }, { now })

  const dataAsOf = latestOf(cooperation.updatedAt, meetings.data[0]?.updatedAt ?? null)

  const draft: AiStoryDto = {
    subject: { type: 'Cooperation', id: cooperationId },
    text: outcome.text,
    source: outcome.source,
    provider: outcome.provider,
    model: outcome.model,
    fallbackReason: outcome.fallbackReason,
    facts: prompt.facts,
    mainBlocker,
    generatedAt: now.toISOString(),
    dataAsOf,
  }

  await writeAudit({
    userId: user.id,
    action: 'ai.story',
    objectType: 'Cooperation',
    objectId: cooperationId,
    payload: { source: draft.source, provider: draft.provider, fallbackReason: draft.fallbackReason },
  })

  return draft
}

// ─────────────────────────── История вуза ────────────────────────────────────

export async function getUniversityStory(user: CurrentUser, universityId: string): Promise<AiStoryDto> {
  assertCan(user, 'ANALYTICS')
  const university = await universitiesService.getById(user, universityId)
  const now = new Date()

  const [activeResult, totalResult, meetings] = await Promise.all([
    cooperationService.list(user, {
      page: 1,
      pageSize: AI_STORY.universityCooperationsListed,
      universityId,
      status: [...OPEN_COOPERATION_STATUSES],
      sort: '-updatedAt',
    }),
    cooperationService.list(user, { page: 1, pageSize: 1, universityId }),
    meetingsService.list(user, { page: 1, pageSize: 1, universityId, sort: '-date' }),
  ])

  const details = await Promise.all(activeResult.data.map((item) => cooperationService.getById(user, item.id)))
  const documentsByCooperation = await Promise.all(details.map((item) => repo.findDocumentsSummary(item.id)))
  const openRecommendationsByCooperation = await Promise.all(
    details.map((item) =>
      recommendationsService.list(user, {
        page: 1,
        pageSize: 1,
        cooperationId: item.id,
        status: [...OPEN_RECOMMENDATION_STATUSES],
        sort: RECOMMENDATION_SORT_MOST_IMPORTANT,
      }),
    ),
  )

  const blockersByCooperation = details.map((item, index) =>
    computeBlockers({ cooperation: item, documents: documentsByCooperation[index]! }),
  )
  const mainBlocker = pickMainBlocker(blockersByCooperation.flat())
  const openRecommendations = openRecommendationsByCooperation.reduce((sum, item) => sum + item.meta.total, 0)

  const listed: UniversityCooperationBrief[] = details.map((item) => {
    const { current } = currentAndNextStage(item.stages)
    return {
      id: item.id,
      programName: item.programName,
      status: item.status,
      currentStage: current ? toStageRef(current) : null,
    }
  })

  const facts: UniversityStoryFacts = {
    universityName: university.name,
    universityShortName: university.shortName,
    cooperationsTotal: totalResult.meta.total,
    cooperationsActive: activeResult.meta.total,
    cooperationsCompleted: totalResult.meta.total - activeResult.meta.total,
    listed,
    meetings: { total: meetings.meta.total, lastAt: meetings.data[0]?.date ?? null },
    openRecommendations,
    mainBlocker,
  }

  const redactionContext = await aiAssistRepo.findRedactionContext([universityId])
  const masker = createMasker(redactionContext.people, [
    university.name,
    university.shortName ?? '',
    ...details.flatMap((item) => cooperationKeepNames(item)),
  ])
  const prompt = buildUniversityStoryPrompt(facts, masker)
  const outcome = await composeStory(prompt, masker, user, { type: 'University', id: universityId }, { now })

  const dataAsOf = latestOf(
    university.updatedAt,
    ...details.map((item) => item.updatedAt),
    meetings.data[0]?.updatedAt ?? null,
  )

  const draft: AiStoryDto = {
    subject: { type: 'University', id: universityId },
    text: outcome.text,
    source: outcome.source,
    provider: outcome.provider,
    model: outcome.model,
    fallbackReason: outcome.fallbackReason,
    facts: prompt.facts,
    mainBlocker,
    generatedAt: now.toISOString(),
    dataAsOf,
  }

  await writeAudit({
    userId: user.id,
    action: 'ai.story',
    objectType: 'University',
    objectId: universityId,
    payload: { source: draft.source, provider: draft.provider, fallbackReason: draft.fallbackReason },
  })

  return draft
}

// ─────────────────────────── Предложить план ─────────────────────────────────

/**
 * Проект плана: только чтение и расчёт, в базу ничего не пишется. Право — как
 * у письма вузу по рекомендации (решение 90): те, кто меняет данные, — ADMIN, MANAGER.
 * Представителю вуза недоступно вовсе: применённый проект меняет расписание связки
 * его же вуза, а это решение остаётся за ИТ-Школой.
 */
export async function createProposal(
  user: CurrentUser,
  cooperationId: string,
  input: CreateProposalInput,
): Promise<AiProposalDto> {
  assertCan(user, 'WRITE')
  const cooperation = await cooperationService.getById(user, cooperationId)
  if (isClosedStatus(cooperation.status)) {
    throw conflict('Связка закрыта: предложить план нельзя', { status: cooperation.status })
  }

  const documents = await repo.findDocumentsSummary(cooperationId)
  const blockers = computeBlockers({ cooperation, documents })
  const { current } = currentAndNextStage(cooperation.stages)
  if (!current) {
    throw conflict('Все этапы связки закрыты — предлагать план нечего')
  }

  const kind: AiProposalKind = input.kind ?? chooseProposalKind(blockers)
  const now = new Date()
  const workingDay = nextWorkingDay(now)
  const warnings = buildProposalWarnings(workingDay, blockers)

  const cooperationLabel = `${cooperation.universityShortName ?? cooperation.universityName} — «${cooperation.programName}»`
  const payload =
    kind === 'meeting'
      ? buildMeetingProposalPayload(
          cooperationId,
          cooperationLabel,
          cooperation.responsible.id,
          blockers,
          workingDay,
        )
      : buildTaskProposalPayload(
          {
            stageId: current.id,
            stageNumber: current.stageNumber,
            stageTitle: current.title,
            currentDeadline: current.deadline,
          },
          workingDay,
        )

  // Шаблон плана строится и без провайдера — модель здесь не формулирует ничего:
  // повестка и дата уже готовый текст, «предложить план» не пишет прозу, которую
  // стоило бы кому-то переформулировать.
  const record = saveProposal(
    {
      cooperationId,
      kind,
      payload,
      sourceVersion: cooperation.updatedAt,
      warnings,
      source: 'template',
      provider: null,
      model: null,
    },
    now.getTime(),
  )

  await writeAudit({
    userId: user.id,
    action: 'ai.proposal.created',
    objectType: 'Cooperation',
    objectId: cooperationId,
    payload: { proposalId: record.proposalId, kind },
  })

  return toProposalDto(record)
}

/**
 * Применение проекта: повторная проверка прав (в `assertCan` выше по стеку — уже
 * не поможет: маршрут вызывает её тоже) и версии связки, запись — штатным сервисом
 * встречи или этапа, а не прямой записью в базу (решение 138).
 */
export async function applyProposal(
  user: CurrentUser,
  cooperationId: string,
  proposalId: string,
): Promise<AiProposalAppliedDto> {
  assertCan(user, 'WRITE')
  const now = Date.now()
  const record = findProposal(proposalId, now)
  if (!record || record.cooperationId !== cooperationId) {
    throw notFound('Проект предложения не найден или уже истёк')
  }

  const cooperation = await cooperationService.getById(user, cooperationId)
  if (cooperation.updatedAt !== record.sourceVersion) {
    throw conflict('Данные связки изменились, обновите предложение', {
      sourceVersion: record.sourceVersion,
      currentVersion: cooperation.updatedAt,
    })
  }

  let meeting: AiProposalAppliedDto['meeting'] = null
  let stage: AiProposalAppliedDto['stage'] = null

  if (record.payload.kind === 'meeting') {
    meeting = await meetingsService.create(user, {
      cooperationId,
      date: record.payload.date,
      topic: record.payload.topic,
      format: record.payload.format,
      responsibleId: record.payload.responsibleId,
    })
  } else {
    stage = await workflowService.updateStage(user, record.payload.stageId, {
      deadline: record.payload.dueDate,
    })
  }

  consumeProposal(proposalId)

  await writeAudit({
    userId: user.id,
    action: 'ai.proposal.applied',
    objectType: 'Cooperation',
    objectId: cooperationId,
    payload: { proposalId, kind: record.kind },
  })

  return { proposalId, kind: record.kind, meeting, stage }
}
