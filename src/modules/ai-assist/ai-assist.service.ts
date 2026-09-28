import { assertCan } from '@/shared/auth/permissions'
import { writeAudit } from '@/shared/audit/audit'
import { AI_TODAY_ITEMS } from '@/shared/config/ai-assist.config'
import type { CurrentUser } from '@/shared/auth/current-user'
import {
  AI_FALLBACK_REASON_LABELS,
  AI_PERSONAL_DATA_NOTICE,
  type AiDraftDto,
  type AiFallbackReason,
  type AiRewriteDto,
  type AiRewriteStatusDto,
  type AiRewriteStyle,
  parseProductOfferTargetId,
  productOfferTargetId,
} from '@/shared/contracts/ai-assist'
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
import { createRedactor, personalDataLeft, type Redact } from './ai-assist.privacy'
import { log } from '@/shared/log/logger'
import {
  buildLetterPrompt,
  buildProductOfferPrompt,
  buildRewritePrompt,
  buildSummaryPrompt,
  buildTodayPrompt,
  type AiPrompt,
} from './ai-assist.prompts'
import { loadLetterInstruction } from './ai-assist.letter-instruction'
import { maskPersonName, productOfferFacts } from './product-offer.letter'
import * as productMatchService from '@/modules/recommendations/product-match.service'
import type { ProductOfferLetterDto } from '@/shared/contracts/product-recommendation'
import { notFound } from '@/shared/http/errors'
import {
  cleanModelText,
  letterFacts,
  summaryFacts,
  todayItems,
  type ProgramLabel,
} from './ai-assist.rules'

/**
 * ИИ-помощник (решение 90): сводка по связке, письмо вузу, дела на сегодня.
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

  // Остаточная проверка (решение 226): маска заменяет только то, что узнаёт уверенно.
  // Остался признак персональных данных — запрос не уходит, человек видит почему.
  const leaks = personalDataLeft(options.redact, `${prompt.system}\n${prompt.user}`)
  if (leaks.length > 0) {
    // Только виды признаков: ни текста, ни найденных значений.
    log.warn('[AI] в тексте остались персональные данные, запрос в модель не отправлен', {
      kind: prompt.kind,
      leaks: leaks.join(','),
    })
    return template('personal-data')
  }

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
    log.warn('[AI] модель не дала черновик, отдан шаблон', { provider: source, failure })
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
 * Всё, что нужно письму по рекомендации: сама рекомендация и маскировка с её
 * названиями. Общее у черновика и его переделки (решение 213) — правила
 * маскировки одни и те же, чтобы переделка не пропустила в модель то, что
 * не пропустил исходный черновик.
 */
async function recommendationLetterContext(user: CurrentUser, recommendationId: string) {
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
  return { recommendation, cooperation, program, redact }
}

/**
 * Черновик письма вузу. Только тем, кто меняет данные (ADMIN, MANAGER):
 * письмо — действие от имени ИТ-Школы, а не просмотр аналитики.
 */
export async function draftRecommendationLetter(
  user: CurrentUser,
  recommendationId: string,
): Promise<AiDraftDto> {
  assertCan(user, 'WRITE')
  const { recommendation, cooperation, program, redact } = await recommendationLetterContext(user, recommendationId)
  const instruction = await loadLetterInstruction()
  const prompt = buildLetterPrompt(letterFacts(recommendation, { cooperation, program }), redact, instruction)
  const outcome = await compose(prompt, user.id, { redact })

  await audit(user, outcome, 'Recommendation', recommendationId)
  return { ...outcome.draft, rewriteTarget: { type: 'recommendation-letter', id: recommendationId } }
}

// ─────────────────────── Переделка черновика письма (решение 213) ────────────

/** Можно ли сейчас переделывать текст моделью — для кнопок под черновиком. */
export function rewriteStatus(user: CurrentUser, provider: LlmProvider = getLlmProvider()): AiRewriteStatusDto {
  assertCan(user, 'READ')
  const info = provider.info()
  if (info.kind === 'off') {
    return {
      available: false,
      reason: 'ИИ-помощник выключен на сервере — переделать текст нечем. Черновик можно править вручную.',
    }
  }
  if (!info.ready) {
    return {
      available: false,
      reason: 'ИИ-помощник не настроен: нет ключа доступа к модели. Черновик можно править вручную.',
    }
  }
  return { available: true, reason: null }
}

export interface RewriteDraftInput {
  kind: 'recommendation-letter' | 'inbound-letter-reply' | 'product-offer-letter'
  text: string
  style: AiRewriteStyle
}

/**
 * Переделать черновик письма по кнопке: текст сотрудника с его правками, задание
 * кнопки, инструкция администратора. Тот же конвейер, что у черновика (`compose`):
 * лимит генераций, кэш, маскировка входа и ответа, журнал. Не вышло (модель
 * выключена, упала, не уложилась в лимит, потеряла подпись) — прежний текст
 * и пояснение; ответ всегда 200.
 *
 * Права и видимость объекта проверяет вызывающий сервис: он же даёт `redact`
 * с названиями своего вуза.
 */
export async function rewriteDraft(
  user: CurrentUser,
  input: RewriteDraftInput,
  options: {
    redact: Redact
    subject: { objectType: 'Recommendation' | 'InboundLetter' | 'EducationalProgram'; objectId: string }
    provider?: LlmProvider
    now?: Date
  },
): Promise<AiRewriteDto> {
  const instruction = await loadLetterInstruction()
  const prompt = buildRewritePrompt(input, options.redact, instruction)
  const outcome = await compose(prompt, user.id, {
    redact: options.redact,
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.now ? { now: options.now } : {}),
  })
  const { draft } = outcome
  const rewritten = draft.source !== 'template'

  const notice = !rewritten
    ? draft.fallbackReason === 'personal-data'
      ? AI_PERSONAL_DATA_NOTICE
      : `Текст не переделан: ${draft.fallbackReason ? AI_FALLBACK_REASON_LABELS[draft.fallbackReason] : 'модель не дала текста'}. Черновик остался прежним.`
    : prompt.masked
      ? 'Перед отправкой в ИИ из текста скрыты персональные данные — в новом варианте на их месте пометки. Верните нужное вручную.'
      : null

  // Ни текста, ни инструкции: только что переделывали, как и чем закончилось.
  await writeAudit({
    userId: user.id,
    action: 'ai.rewrite',
    objectType: options.subject.objectType,
    objectId: options.subject.objectId,
    payload: {
      kind: input.kind,
      style: input.style,
      provider: outcome.provider,
      outcome: rewritten ? 'model' : 'unchanged',
      source: draft.source,
      model: draft.model,
      fallbackReason: draft.fallbackReason,
      cached: draft.cached,
      masked: prompt.masked,
      withInstruction: instruction !== null,
    },
  })

  return {
    text: rewritten ? draft.text : input.text,
    rewritten,
    style: input.style,
    source: draft.source,
    model: draft.model,
    fallbackReason: draft.fallbackReason,
    notice,
    masked: prompt.masked,
    cached: draft.cached,
    generatedAt: draft.generatedAt,
  }
}

/** Переделка письма вузу по рекомендации: права — как у самого черновика (WRITE). */
export async function rewriteRecommendationLetter(
  user: CurrentUser,
  recommendationId: string,
  input: { text: string; style: AiRewriteStyle },
): Promise<AiRewriteDto> {
  assertCan(user, 'WRITE')
  const { redact } = await recommendationLetterContext(user, recommendationId)
  return rewriteDraft(
    user,
    { kind: 'recommendation-letter', text: input.text, style: input.style },
    { redact, subject: { objectType: 'Recommendation', objectId: recommendationId } },
  )
}

// ─────────────── Письмо с предложением продукта (решение 223) ────────────────

/**
 * Всё, что нужно письму-предложению: пара «программа × продукт» с баллом и причинами,
 * навыки продукта, идущая связка вуза и маскировка с названиями этой пары. Общее
 * у черновика и его переделки — как у письма по задаче (решение 213).
 */
async function productOfferContext(user: CurrentUser, programId: string, productId: string) {
  productMatchService.assertCanDraftOfferLetter(user)
  const { recommendation, period, isMock } = await productMatchService.pairFor(user, programId, productId)
  const [productSkills, open] = await Promise.all([
    repo.findProductSkillNames(productId),
    productMatchService.openCooperationsOf(recommendation.program.universityId),
  ])
  const existing = open.find((row) => row.productId !== productId && row.productName !== null) ?? null
  const redact = await redactorFor(
    [recommendation.program.universityId],
    [
      recommendation.program.universityName,
      recommendation.program.name,
      recommendation.product.name,
      ...productSkills,
      ...(existing ? [existing.programName, existing.productName ?? ''] : []),
    ],
  )
  const facts = productOfferFacts({
    recommendation,
    productSkills,
    period,
    existing: existing ? { programName: existing.programName, productName: existing.productName! } : null,
  })
  return { recommendation, facts, redact, isMock }
}

/**
 * Черновик письма вузу с предложением продукта. Письмо не отправляется и не
 * сохраняется: эксперт (решение 147) его видит — это чтение; роль — та, что пишет
 * вузам (`canDraftOfferLetter`).
 */
export async function draftProductOfferLetter(
  user: CurrentUser,
  programId: string,
  productId: string,
): Promise<ProductOfferLetterDto> {
  const { recommendation, facts, redact, isMock } = await productOfferContext(user, programId, productId)
  const [instruction, contact] = await Promise.all([
    loadLetterInstruction(),
    productMatchService.findPrimaryContact(recommendation.program.universityId),
  ])
  const outcome = await compose(buildProductOfferPrompt(facts, redact, instruction), user.id, { redact })
  await audit(user, outcome, 'EducationalProgram', programId)

  return {
    ...outcome.draft,
    rewriteTarget: { type: 'product-offer-letter', id: productOfferTargetId(programId, productId) },
    universityName: recommendation.program.universityName,
    programName: recommendation.program.name,
    productName: recommendation.product.name,
    recipient: {
      maskedName: contact ? maskPersonName(contact.fullName) : null,
      position: contact?.position ?? null,
    },
    isMock,
  }
}

/** Переделка письма-предложения кнопками: права и маскировка — как у самого черновика. */
export async function rewriteProductOfferLetter(
  user: CurrentUser,
  targetId: string,
  input: { text: string; style: AiRewriteStyle },
): Promise<AiRewriteDto> {
  const pair = parseProductOfferTargetId(targetId)
  if (!pair) throw notFound('Письмо не найдено')
  const { redact } = await productOfferContext(user, pair.programId, pair.productId)
  return rewriteDraft(
    user,
    { kind: 'product-offer-letter', text: input.text, style: input.style },
    { redact, subject: { objectType: 'EducationalProgram', objectId: pair.programId } },
  )
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
