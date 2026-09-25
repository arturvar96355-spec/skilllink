import { assertCan } from '@/shared/auth/permissions'
import { writeAudit } from '@/shared/audit/audit'
import { AI_TODAY_ITEMS } from '@/shared/config/ai-assist.config'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { AiDraftDto, AiFallbackReason } from '@/shared/contracts/ai-assist'
import type { CooperationDto } from '@/shared/contracts/cooperation'
import {
  RECOMMENDATION_SORT_MOST_IMPORTANT,
  type RecommendationDto,
} from '@/shared/contracts/recommendation'
import type { AiAssistProviderKind } from '@/integrations/config'
import { getLlmProvider, llmFailureKind, type LlmProvider } from '@/integrations/llm'
import * as cooperationService from '@/modules/cooperation/cooperation.service'
import * as recommendationsService from '@/modules/recommendations/recommendations.service'
import { OPEN_RECOMMENDATION_STATUSES } from '@/modules/recommendations/recommendations.rules'
import * as repo from './ai-assist.repo'
import { cacheKey, readCache, takeGeneration, writeCache } from './ai-assist.limits'
import { createRedactor, type Redact } from './ai-assist.privacy'
import {
  buildLetterPrompt,
  buildSummaryPrompt,
  buildTodayPrompt,
  type AiPrompt,
} from './ai-assist.prompts'
import {
  cleanModelText,
  letterFacts,
  summaryFacts,
  todayItems,
  type ProgramLabel,
} from './ai-assist.rules'

/**
 * ИИ-помощник (решение 84): сводка по связке, письмо вузу, дела на сегодня.
 *
 * Что сказать, решают правила и сервисы, которые уже есть: карточка связки,
 * лента рекомендаций, проблемные этапы. Модель получает готовые факты без
 * персональных данных и только формулирует текст. Выключена, не настроена,
 * упала, промолчала, не уложилась в лимит — тот же текст пишет шаблон,
 * и ответ всегда 200.
 */

export interface ComposeOutcome {
  draft: AiDraftDto
  provider: AiAssistProviderKind
}

/**
 * Черновик по готовому промпту: кэш, лимит, модель, запасной шаблон.
 * Исключений наружу не бросает — сбой модели не становится ошибкой запроса.
 */
export async function compose(
  prompt: AiPrompt,
  userId: string,
  options: { redact: Redact; provider?: LlmProvider; now?: Date },
): Promise<ComposeOutcome> {
  const provider = options.provider ?? getLlmProvider()
  const info = provider.info()
  const now = options.now ?? new Date()
  const base = { kind: prompt.kind, generatedAt: now.toISOString(), facts: prompt.facts }

  const template = (reason: AiFallbackReason): ComposeOutcome => ({
    draft: { ...base, text: prompt.template, source: 'template', model: null, fallbackReason: reason, cached: false },
    provider: info.kind,
  })

  if (prompt.facts.length === 0) return template('no-facts')
  if (info.kind === 'off') return template('disabled')
  if (!info.ready) return template('not-configured')
  const source = info.kind

  const key = cacheKey([source, info.model ?? '', prompt.system, prompt.user])
  const cached = readCache(key, now.getTime())
  if (cached) {
    return {
      draft: { ...base, text: cached.text, source: cached.source, model: cached.model, fallbackReason: null, cached: true },
      provider: source,
    }
  }

  if (!takeGeneration(userId, now.getTime())) return template('rate-limited')

  try {
    const completion = await provider.generate({ system: prompt.system, user: prompt.user })
    // Модель могла дописать выдуманный телефон или адрес — ответ чистится так же, как вход.
    const text = options.redact(cleanModelText(completion.text))
    if (text === '') return template('empty')
    if (!prompt.accepts(text)) return template('invalid')

    writeCache(key, { text, source, model: completion.model }, now.getTime())
    return {
      draft: { ...base, text, source, model: completion.model, fallbackReason: null, cached: false },
      provider: source,
    }
  } catch (error) {
    const failure = llmFailureKind(error)
    // Без текста промпта и ответа: в журнал попадает только вид сбоя.
    console.warn(`[AI] ${source}: модель не дала черновик (${failure}), отдан шаблон`)
    return template(failure === 'timeout' ? 'timeout' : failure === 'empty' ? 'empty' : 'failed')
  }
}

async function audit(
  user: CurrentUser,
  outcome: ComposeOutcome,
  objectType: string,
  objectId: string,
): Promise<void> {
  // Ни промпта, ни ответа: только что, по чему и чем закончилось.
  await writeAudit({
    userId: user.id,
    action: 'ai.draft',
    objectType,
    objectId,
    payload: {
      kind: outcome.draft.kind,
      provider: outcome.provider,
      outcome: outcome.draft.source === 'template' ? 'template' : 'model',
      source: outcome.draft.source,
      model: outcome.draft.model,
      fallbackReason: outcome.draft.fallbackReason,
      cached: outcome.draft.cached,
    },
  })
}

/** Официальные названия из карточки связки: они уходят в модель как есть. */
function cooperationNames(cooperation: CooperationDto | null): string[] {
  if (!cooperation) return []
  return [
    cooperation.universityName,
    cooperation.universityShortName ?? '',
    cooperation.programName,
    cooperation.productName ?? '',
    ...cooperation.stages.map((stage) => stage.title),
  ]
}

/** Названия внутри данных правила: продукты, программы и вузы дефицита навыка. */
function relatedNames(recommendation: RecommendationDto): string[] {
  const data = recommendation.relatedData ?? {}
  const names: string[] = [recommendation.target.label]
  for (const key of ['products', 'programs'] as const) {
    const list = data[key]
    if (!Array.isArray(list)) continue
    for (const item of list as Array<Record<string, unknown>>) {
      for (const field of ['name', 'universityName']) {
        if (typeof item[field] === 'string') names.push(item[field])
      }
    }
  }
  return names
}

async function redactorFor(universityIds: readonly string[], names: readonly string[]): Promise<Redact> {
  const context = await repo.findRedactionContext(universityIds)
  return createRedactor(context.people, [...context.universityNames, ...names])
}

// ─────────────────────────── Сводка по связке ───────────────────────────────

/**
 * Сводка по связке. Право — как у рекомендаций (аналитика): представителю вуза
 * 403; чужая или несуществующая связка — 404 из карточки связки.
 */
export async function summarizeCooperation(user: CurrentUser, cooperationId: string): Promise<AiDraftDto> {
  assertCan(user, 'ANALYTICS')
  const cooperation = await cooperationService.getById(user, cooperationId)
  const { data: recommendations } = await recommendationsService.list(user, {
    page: 1,
    pageSize: 20,
    cooperationId,
    status: [...OPEN_RECOMMENDATION_STATUSES],
    sort: RECOMMENDATION_SORT_MOST_IMPORTANT,
  })

  const now = new Date()
  const redact = await redactorFor([cooperation.universityId], cooperationNames(cooperation))
  const prompt = buildSummaryPrompt(summaryFacts(cooperation, recommendations, now), redact)
  const outcome = await compose(prompt, user.id, { redact, now })

  await audit(user, outcome, 'Cooperation', cooperationId)
  return outcome.draft
}

// ─────────────────────── Письмо вузу по рекомендации ─────────────────────────

/**
 * Черновик письма вузу. Только тем, кто меняет данные (ADMIN, MANAGER):
 * письмо — действие от имени ИТ-Школы, а не просмотр аналитики.
 */
export async function draftRecommendationLetter(
  user: CurrentUser,
  recommendationId: string,
): Promise<AiDraftDto> {
  assertCan(user, 'WRITE')
  const recommendation = await recommendationsService.getById(user, recommendationId)

  const cooperation = recommendation.cooperationId
    ? await cooperationService.getById(user, recommendation.cooperationId)
    : null
  const programRow =
    recommendation.target.objectType === 'EducationalProgram'
      ? await repo.findProgramLabel(recommendation.target.objectId)
      : null
  const program: ProgramLabel | null = programRow
    ? {
        name: programRow.name,
        universityName: programRow.universityName,
        universityShortName: programRow.universityShortName,
      }
    : null

  const redact = await redactorFor(
    [cooperation?.universityId, programRow?.universityId].filter((id): id is string => Boolean(id)),
    [...cooperationNames(cooperation), ...relatedNames(recommendation), program?.name ?? ''],
  )
  const prompt = buildLetterPrompt(letterFacts(recommendation, { cooperation, program }), redact)
  const outcome = await compose(prompt, user.id, { redact })

  await audit(user, outcome, 'Recommendation', recommendationId)
  return outcome.draft
}

// ─────────────────────────── «Что сделать сегодня» ───────────────────────────

/** Сколько кандидатов брать из базы: с запасом на склейку и отсев запертых этапов. */
const TODAY_FETCH_LIMIT = 30

/**
 * Дела на сегодня для текущего пользователя: его открытые рекомендации
 * и проблемные этапы его связок, порядок — по правилам (`todayItems`).
 */
export async function todayPlan(user: CurrentUser): Promise<AiDraftDto> {
  assertCan(user, 'ANALYTICS')
  const now = new Date()

  const [ownRows, stages, generalRows] = await Promise.all([
    repo.findOpenRecommendationsOf(user.id, TODAY_FETCH_LIMIT),
    repo.findProblemStagesOf(user.id, now, TODAY_FETCH_LIMIT),
    repo.findGeneralRecommendations(user.id, AI_TODAY_ITEMS.max),
  ])
  const [own, general] = await Promise.all([
    recommendationsService.toRecommendationDtos(ownRows),
    recommendationsService.toRecommendationDtos(generalRows),
  ])

  const items = todayItems({ own, stages, general, now })
  const redact = await redactorFor(
    stages.map((stage) => stage.universityId),
    [
      ...stages.flatMap((stage) => [stage.programName, stage.title]),
      ...[...own, ...general].flatMap(relatedNames),
    ],
  )
  const outcome = await compose(buildTodayPrompt(items, redact), user.id, { redact, now })

  await audit(user, outcome, 'User', user.id)
  return outcome.draft
}
