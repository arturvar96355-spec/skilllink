import { conflict, forbidden, notFound, validationError } from '@/shared/http/errors'
import { pageMeta } from '@/shared/http/pagination'
import { assertCan } from '@/shared/auth/permissions'
import { writeAudit } from '@/shared/audit/audit'
import { log } from '@/shared/log/logger'
import { toIso, toIsoRequired } from '@/shared/utils/date'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { UploadedFile } from '@/shared/http/request'
import type { AiDraftSource } from '@/shared/contracts/ai-assist'
import type { PageMeta } from '@/shared/contracts/common'
import {
  INBOUND_LETTER_GROUPS,
  INBOUND_LETTER_OPEN_STATUSES,
  type InboundLetterGroup,
  type InboundLetterStatus,
} from '@/shared/contracts/enums'
import type {
  InboundLetterAnalysisDto,
  InboundLetterDto,
  InboundLetterGroupStatsDto,
  InboundLetterListItemDto,
  InboundLetterStatsDto,
} from '@/shared/contracts/inbound-letters'
import { INBOUND_LETTER_LEARNING, LETTER_PREVIEW_LENGTH, SIMILAR_EXAMPLES_LIMIT } from '@/shared/config/inbound-letters.config'
import { getLlmProvider } from '@/integrations/llm'
import { compose } from '@/modules/ai-assist/ai-assist.service'
import { findRedactionContext } from '@/modules/ai-assist/ai-assist.repo'
import { createRedactor, type Redact } from '@/modules/ai-assist/ai-assist.privacy'
import { coolDown } from '@/modules/recommendations/recommendations.learning'
import { sendToUser } from '@/modules/notify-channels/notify-channels.service'
import * as repo from './inbound-letters.repo'
import { parseEml } from './inbound-letters.eml'
import { matchUniversityByDomain } from './inbound-letters.match'
import { classifyByRules, bodyPreview, groupLabel, stripSignature, type RuleClassification } from './inbound-letters.rules'
import { findSimilar } from './inbound-letters.similarity'
import { buildAnalysisPrompt, buildReplyDraftPrompt, tryParseAnalysis, type AnalysisExample } from './inbound-letters.prompts'
import type {
  DismissLetterInput,
  InboundLetterListQuery,
  ReviewLetterInput,
  UpdateReplyDraftInput,
} from './inbound-letters.schema'

/**
 * Письма вузов как обращения (решение 170).
 *
 * Живого почтового ящика нет: письмо приходит через демо-набор (`prisma/seed.ts`)
 * или загрузку `.eml` (`upload`). Разбор — код (домен отправителя, связка, этап,
 * ключевые слова) плюс, если подключена модель, YandexGPT/GigaChat; на выходе одно
 * из двух: разбор моделью или разбор правилами (правила — всегда как минимум
 * запасной путь). Проверка сотрудником («Верно»/«Неверно», `review`) — размеченный
 * пример для следующего разбора (похожие письма, точность по группе) и задание
 * ответственному за вуз. Ответ вузу — только черновик, отправки нет.
 */

async function redactorFor(universityIds: readonly string[], names: readonly string[]): Promise<Redact> {
  const context = await findRedactionContext(universityIds)
  return createRedactor(context.people, [...context.universityNames, ...names])
}

// ─────────────────────────── Уведомление о новом письме ──────────────────────

/** Только название вуза и группа обращения — без ФИО, почты, текста письма (решение 183). */
function newLetterNoticeText(universityName: string | null, group: InboundLetterGroup): string {
  return `Новое письмо от вуза ${universityName ?? 'неизвестного вуза'}: ${groupLabel(group)}`
}

/**
 * ADMIN и HEAD — о каждом новом обращении (решение 183), через уже подключённый
 * ими канал (`sendToUser`, решение 144): ничего не подключено — тихо не уходит,
 * как и у сводки «что горит у меня». Только по загрузке письма — не по повторному
 * разбору (`POST …/:id/analyze` вызывает тот же `analyzeLetter`, но это не новое
 * письмо). Сбой отправки не должен ронять загрузку — best-effort, ошибка в журнал.
 */
async function notifyNewLetter(universityName: string | null, group: InboundLetterGroup): Promise<void> {
  try {
    const recipients = await repo.listNoticeRecipientIds()
    const text = newLetterNoticeText(universityName, group)
    await Promise.all(recipients.map((userId) => sendToUser(userId, text)))
  } catch (error) {
    log.warn('[inbound-letters] уведомление о новом письме не отправлено', { err: error })
  }
}

// ─────────────────────────────────── DTO ─────────────────────────────────────

function analysisOf(
  universityId: string | null,
  cooperationId: string | null,
  stageNumber: number | null,
  group: InboundLetterGroup | null,
  action: string | null,
  confidence: number | null,
  quotes: unknown,
  analyzedBy: 'MODEL' | 'RULES' | null,
  analyzedNote: string | null,
  analyzedAt: Date | null,
  universityNames: ReadonlyMap<string, string>,
): InboundLetterAnalysisDto {
  return {
    universityId,
    universityName: universityId ? universityNames.get(universityId) ?? null : null,
    cooperationId,
    stageNumber,
    group,
    action,
    confidence,
    quotes: Array.isArray(quotes) ? (quotes as unknown[]).filter((item): item is string => typeof item === 'string') : [],
    analyzedBy,
    fallbackReason: analyzedBy === 'RULES' ? ((analyzedNote as InboundLetterAnalysisDto['fallbackReason']) ?? null) : null,
    analyzedAt: toIso(analyzedAt),
  }
}

function toDto(row: repo.LetterRow, universityNames: ReadonlyMap<string, string>): InboundLetterDto {
  return {
    id: row.id,
    senderEmail: row.senderEmail,
    senderName: row.senderName,
    subject: row.subject,
    bodyText: row.bodyText,
    receivedAt: toIsoRequired(row.receivedAt),
    source: row.source,
    messageId: row.messageId,
    status: row.status,
    current: analysisOf(
      row.universityId,
      row.cooperationId,
      row.stageNumber,
      row.group,
      row.action,
      row.confidence,
      row.quotes,
      row.analyzedBy,
      row.analyzedNote,
      row.analyzedAt,
      universityNames,
    ),
    detected: analysisOf(
      row.detectedUniversityId,
      row.detectedCooperationId,
      row.detectedStageNumber,
      row.detectedGroup,
      row.detectedAction,
      row.confidence,
      row.quotes,
      row.analyzedBy,
      row.analyzedNote,
      row.analyzedAt,
      universityNames,
    ),
    review: row.reviewedById
      ? {
          reviewedById: row.reviewedById,
          reviewedByName: row.reviewedBy?.fullName ?? null,
          reviewedAt: toIso(row.reviewedAt),
          verdict: row.verdict,
          comment: row.reviewComment,
        }
      : null,
    task: row.task
      ? {
          id: row.task.id,
          responsibleId: row.task.responsibleId,
          responsibleName: row.task.responsible?.fullName ?? null,
          status: row.task.status,
          title: row.task.title,
          createdAt: toIsoRequired(row.task.createdAt),
        }
      : null,
    replyDraft:
      row.replyDraft && row.replyDraftSource && row.replyDraftUpdatedAt
        ? {
            text: row.replyDraft,
            // Значение ограничено CHECK-ограничением базы (`yandexgpt`|`gigachat`|`template`).
            source: row.replyDraftSource as AiDraftSource,
            updatedAt: toIsoRequired(row.replyDraftUpdatedAt),
            mailto: mailtoLink(row.senderEmail, row.subject, row.replyDraft),
          }
        : null,
    isMock: row.isMock,
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  }
}

/** Ссылка `mailto:` с темой «Re: …» и текстом — кнопка «Открыть в почте». */
const MAILTO_MAX_LENGTH = 1800 // TEMP: запас под ограничения адресной строки браузера

function mailtoLink(to: string, subject: string, body: string): string {
  const replySubject = /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`
  let link = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(replySubject)}&body=${encodeURIComponent(body)}`
  if (link.length > MAILTO_MAX_LENGTH) {
    const truncatedBody = `${body.slice(0, 400)}…`
    link = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(replySubject)}&body=${encodeURIComponent(truncatedBody)}`
  }
  return link
}

async function withUniversityNames(rows: readonly repo.LetterRow[]): Promise<Map<string, string>> {
  const ids = rows.flatMap((row) => [row.universityId, row.detectedUniversityId]).filter((id): id is string => Boolean(id))
  return repo.findUniversityNames(ids)
}

// ────────────────────────────────── Доступ ───────────────────────────────────

function scopeFor(user: CurrentUser) {
  return user.role === 'MANAGER' ? repo.managerScope(user.id) : {}
}

async function assertVisible(user: CurrentUser, row: repo.LetterRow): Promise<void> {
  if (user.role !== 'MANAGER') return
  const visible = await repo.isVisibleTo(row.id, user.id)
  if (!visible) throw notFound('Обращение не найдено')
}

// ──────────────────────────────────── Чтение ─────────────────────────────────

export async function list(
  user: CurrentUser,
  query: InboundLetterListQuery,
): Promise<{ data: InboundLetterListItemDto[]; meta: PageMeta }> {
  assertCan(user, 'INBOUND_READ')
  const { rows, total } = await repo.findMany(query, scopeFor(user))
  const universityNames = await withUniversityNames(rows)
  const data = rows.map((row) => {
    const { bodyText, replyDraft, ...rest } = toDto(row, universityNames)
    return { ...rest, bodyPreview: bodyPreview(bodyText, LETTER_PREVIEW_LENGTH) }
  })
  return { data, meta: pageMeta({ page: query.page, pageSize: query.pageSize }, total) }
}

export async function getById(user: CurrentUser, id: string): Promise<InboundLetterDto> {
  assertCan(user, 'INBOUND_READ')
  const row = await repo.findById(id)
  if (!row) throw notFound('Обращение не найдено')
  await assertVisible(user, row)
  const universityNames = await withUniversityNames([row])
  return toDto(row, universityNames)
}

// ──────────────────────────────────── Загрузка ───────────────────────────────

/** Больше этого текст письма не хранится — на случай испорченного или огромного файла. */
const MAX_BODY_LENGTH = 20_000

export async function uploadEml(user: CurrentUser, file: UploadedFile): Promise<InboundLetterDto> {
  assertCan(user, 'INBOUND_REVIEW')
  const parsed = parseEml(file.bytes)
  if (!parsed.from.email) {
    throw validationError('Не удалось определить отправителя письма', [{ field: 'file', message: 'В заголовке From нет адреса' }])
  }

  // Повторная загрузка того же .eml (решение 187): без этой проверки заводились
  // второе письмо и вторая задача менеджеру на то же самое обращение. Пустой
  // messageId (в письме не было заголовка Message-ID) не проверяем — пустое
  // значение не отличает одно письмо от другого.
  if (parsed.messageId) {
    const duplicate = await repo.findByMessageId(parsed.messageId, parsed.from.email)
    if (duplicate) {
      throw conflict('Это письмо уже загружено', { letterId: duplicate.id })
    }
  }

  const row = await repo.create({
    senderEmail: parsed.from.email,
    senderName: parsed.from.name,
    subject: parsed.subject || '(без темы)',
    bodyText: parsed.bodyText.slice(0, MAX_BODY_LENGTH),
    receivedAt: parsed.date ?? new Date(),
    source: 'EML_UPLOAD',
    messageId: parsed.messageId,
  })

  await writeAudit({
    userId: user.id,
    action: 'inbound_letter.upload',
    objectType: 'InboundLetter',
    objectId: row.id,
    payload: { source: 'EML_UPLOAD', bytes: file.size },
  })

  const analyzed = await analyzeLetter(user, row.id)
  await notifyNewLetter(analyzed.current.universityName, analyzed.current.group ?? 'OTHER')
  return analyzed
}

// ──────────────────────────────────── Разбор ─────────────────────────────────

function toAnalysisExample(row: repo.LabeledLetterExample): AnalysisExample {
  return { text: bodyPreview(row.text, 300), group: row.group, action: row.action }
}

export async function analyzeLetter(user: CurrentUser, id: string, now: Date = new Date()): Promise<InboundLetterDto> {
  assertCan(user, 'INBOUND_REVIEW')
  const existing = await repo.findById(id)
  if (!existing) throw notFound('Обращение не найдено')
  if (!(INBOUND_LETTER_OPEN_STATUSES as readonly InboundLetterStatus[]).includes(existing.status)) {
    throw conflict('Обращение уже проверено — повторный разбор недоступен')
  }

  // ── Код: вуз по домену отправителя, связка и текущий этап ──────────────────
  const domains = await repo.findUniversityDomains()
  const universityId = matchUniversityByDomain(existing.senderEmail, domains)
  let cooperationId: string | null = null
  let stageNumber: number | null = null
  if (universityId) {
    const cooperationRef = await repo.findActiveCooperation(universityId)
    cooperationId = cooperationRef?.cooperationId ?? null
    stageNumber = cooperationRef?.stageNumber ?? null
  }

  // ── Правила (и результат по умолчанию, и запасной путь модели) ─────────────
  const combinedText = `${existing.subject}\n${existing.bodyText}`
  const rulesResult: RuleClassification = classifyByRules(combinedText)

  // ── Похожие размеченные письма — подсказка модели (few-shot) ────────────────
  const examplesPool = await repo.findLabeledExamples(id)
  const similar = findSimilar(combinedText, examplesPool.map((example) => ({ id: example.id, text: example.text })), SIMILAR_EXAMPLES_LIMIT)
  const examplesById = new Map(examplesPool.map((example) => [example.id, example]))
  const examples = similar.map((match) => toAnalysisExample(examplesById.get(match.id)!))

  const universityNames = await withUniversityNames([existing])
  const knownUniversityName = universityId ? (await repo.findUniversityNames([universityId])).get(universityId) ?? null : null
  const redact = await redactorFor(
    [universityId, existing.universityId].filter((v): v is string => Boolean(v)),
    [...universityNames.values(), ...(knownUniversityName ? [knownUniversityName] : [])],
  )

  const prompt = buildAnalysisPrompt(
    {
      subject: existing.subject,
      // Подпись — отдельно от разбора правилами (`rulesResult` выше): модели её
      // видеть не нужно, а незнакомого отправителя редактор не распознает как ФИО.
      body: stripSignature(existing.bodyText),
      universityName: knownUniversityName,
      stageInfo: stageNumber ? `этап ${stageNumber}` : null,
      examples,
    },
    rulesResult,
    redact,
  )
  const outcome = await compose(prompt, user.id, { redact, now, provider: getLlmProvider() })
  const parsed = tryParseAnalysis(outcome.draft.text) ?? rulesResult
  const analyzedBy = outcome.draft.source === 'template' ? 'RULES' : 'MODEL'

  await repo.saveAnalysis(id, {
    universityId,
    cooperationId,
    stageNumber,
    group: parsed.group,
    action: parsed.action,
    confidence: parsed.confidence,
    quotes: parsed.quotes,
    analyzedBy,
    analyzedNote: analyzedBy === 'RULES' ? outcome.draft.fallbackReason : null,
    analyzedAt: now,
  })

  await writeAudit({
    userId: user.id,
    action: 'inbound_letter.analyze',
    objectType: 'InboundLetter',
    objectId: id,
    payload: { analyzedBy, group: parsed.group, universityFound: universityId !== null, fallbackReason: outcome.draft.fallbackReason },
  })

  return getById(user, id)
}

// ──────────────────────────────────── Проверка ───────────────────────────────

function taskTitle(group: InboundLetterGroup): string {
  return `Письмо вуза: ${groupLabel(group)}`
}

export async function review(user: CurrentUser, id: string, input: ReviewLetterInput): Promise<InboundLetterDto> {
  assertCan(user, 'INBOUND_REVIEW')
  const existing = await repo.findById(id)
  if (!existing) throw notFound('Обращение не найдено')
  if (!(INBOUND_LETTER_OPEN_STATUSES as readonly InboundLetterStatus[]).includes(existing.status)) {
    throw conflict('Обращение уже проверено')
  }

  let universityId: string
  let cooperationId: string | null
  let stageNumber: number | null
  let group: InboundLetterGroup
  let action: string

  if (input.verdict === 'CORRECT') {
    if (!existing.universityId || !existing.group || !existing.action) {
      throw validationError('Разбор не определил вуз или группу — подтвердить нечем. Используйте «Неверно» и укажите правильные значения.', [
        { field: 'verdict', message: 'Разбор неполный' },
      ])
    }
    universityId = existing.universityId
    cooperationId = existing.cooperationId
    stageNumber = existing.stageNumber
    group = existing.group
    action = existing.action
  } else {
    if (!(await repo.assertUniversityExists(input.universityId!))) {
      throw validationError('Вуз не найден', [{ field: 'universityId', message: 'Вуз не найден' }])
    }
    if (input.cooperationId && !(await repo.cooperationBelongsToUniversity(input.cooperationId, input.universityId!))) {
      throw validationError('Связка не относится к указанному вузу', [{ field: 'cooperationId', message: 'Связка принадлежит другому вузу' }])
    }
    universityId = input.universityId!
    // Этап — как в обычном разборе (`analyzeLetter` выше): активная связка
    // вуза, а не безусловный null. Раньше «Неверно» с указанным, но верным
    // вузом всё равно обнуляло этап, хотя обычный разбор для того же вуза
    // нашёл бы его через findActiveCooperation.
    //
    // Если сотрудник сам выбрал связку и она не совпала с тем, что система
    // считает активной связкой вуза, этап не приписывается чужой связке —
    // остаётся null, честно «неизвестно», а не подставляется наугад.
    const cooperationRef = await repo.findActiveCooperation(universityId)
    cooperationId = input.cooperationId ?? cooperationRef?.cooperationId ?? null
    stageNumber = cooperationRef && cooperationRef.cooperationId === cooperationId ? cooperationRef.stageNumber : null
    group = input.group!
    action = input.action!
  }

  const now = new Date()
  const responsibleId = await repo.findResponsible(universityId, cooperationId)
  const row = await repo.saveReviewAndCreateTask(
    {
      status: input.verdict === 'CORRECT' ? 'CONFIRMED' : 'CORRECTED',
      verdict: input.verdict,
      universityId,
      cooperationId,
      stageNumber,
      group,
      action,
      reviewedById: user.id,
      reviewedAt: now,
      comment: input.comment?.trim() || null,
    },
    {
      letterId: id,
      universityId,
      cooperationId,
      responsibleId,
      title: taskTitle(group),
      description: action,
      group,
      action,
    },
  )

  // Обучение (решение 170): угадал ли разбор группу, которую в итоге подтвердили —
  // независимо от того, что было не так с вузом или связкой у «Неверно».
  if (existing.detectedGroup) {
    await repo.recordGroupEvent(existing.detectedGroup, { trials: 1, successes: existing.detectedGroup === group ? 1 : 0 }, now)
  }

  await writeAudit({
    userId: user.id,
    action: 'inbound_letter.review',
    objectType: 'InboundLetter',
    objectId: id,
    payload: { verdict: input.verdict, group, universityId, taskCreated: true },
  })

  const universityNames = await withUniversityNames([row])
  return toDto(row, universityNames)
}

// ─────────────────────────────────── Отклонение ──────────────────────────────

export async function dismissLetter(user: CurrentUser, id: string, input: DismissLetterInput): Promise<InboundLetterDto> {
  assertCan(user, 'INBOUND_REVIEW')
  const existing = await repo.findById(id)
  if (!existing) throw notFound('Обращение не найдено')
  if (!(INBOUND_LETTER_OPEN_STATUSES as readonly InboundLetterStatus[]).includes(existing.status)) {
    throw conflict('Обращение уже проверено')
  }

  const now = new Date()
  const row = await repo.dismiss(id, user.id, now, input.comment?.trim() || null)

  await writeAudit({
    userId: user.id,
    action: 'inbound_letter.dismiss',
    objectType: 'InboundLetter',
    objectId: id,
    payload: {},
  })

  const universityNames = await withUniversityNames([row])
  return toDto(row, universityNames)
}

// ──────────────────────────────── Задание по письму ───────────────────────────

/**
 * «Задание выполнено» (решение 183, дополняет решение 170: там у задания намеренно
 * не было отдельного маршрута — здесь он появляется, `docs/TECHNICAL_DECISIONS.md`).
 *
 * Право — ответственный за задание либо ADMIN/HEAD: `INBOUND_READ` пропускает и
 * MANAGER (он читает письма своих вузов), но отметить чужое задание манагер
 * не может — только своё, если оно на нём.
 */
export async function completeTask(user: CurrentUser, id: string, now: Date = new Date()): Promise<InboundLetterDto> {
  assertCan(user, 'INBOUND_READ')
  const existing = await repo.findById(id)
  if (!existing) throw notFound('Обращение не найдено')
  await assertVisible(user, existing)
  if (!existing.task) throw notFound('У письма нет задания')
  if (existing.task.status === 'DONE') throw conflict('Задание уже отмечено выполненным')

  const isReviewer = user.role === 'ADMIN' || user.role === 'HEAD'
  if (!isReviewer && existing.task.responsibleId !== user.id) {
    throw forbidden('Отметить задание может только ответственный за него, ADMIN или HEAD')
  }

  const row = await repo.completeTask(id, now)

  await writeAudit({
    userId: user.id,
    action: 'inbound_letter.task.done',
    objectType: 'InboundLetter',
    objectId: id,
    payload: {},
  })

  const universityNames = await withUniversityNames([row])
  return toDto(row, universityNames)
}

// ────────────────────────────────── Черновик ответа ──────────────────────────

function currentGroupAction(row: repo.LetterRow): { group: InboundLetterGroup; action: string } {
  const group = row.group ?? row.detectedGroup ?? 'OTHER'
  const action = row.action ?? row.detectedAction ?? 'Ответить вузу по существу письма'
  return { group, action }
}

export async function generateReplyDraft(user: CurrentUser, id: string): Promise<InboundLetterDto> {
  assertCan(user, 'INBOUND_REVIEW')
  const existing = await repo.findById(id)
  if (!existing) throw notFound('Обращение не найдено')
  if (existing.status === 'NEW') throw conflict('Сначала разберите письмо')
  if (existing.status === 'DISMISSED') throw conflict('Письмо отклонено как не по работе — черновик ответа не нужен')

  const { group, action } = currentGroupAction(existing)
  const universityName = existing.universityId ? (await repo.findUniversityNames([existing.universityId])).get(existing.universityId) ?? null : null
  const redact = await redactorFor(existing.universityId ? [existing.universityId] : [], universityName ? [universityName] : [])

  const prompt = buildReplyDraftPrompt({ universityName, subject: existing.subject, group, action }, redact)
  const outcome = await compose(prompt, user.id, { redact, provider: getLlmProvider() })

  const now = new Date()
  const row = await repo.saveReplyDraft(id, outcome.draft.text, outcome.draft.source, now)

  await writeAudit({
    userId: user.id,
    action: 'inbound_letter.reply_draft',
    objectType: 'InboundLetter',
    objectId: id,
    payload: { source: outcome.draft.source, fallbackReason: outcome.draft.fallbackReason },
  })

  const universityNames = await withUniversityNames([row])
  return toDto(row, universityNames)
}

export async function updateReplyDraft(user: CurrentUser, id: string, input: UpdateReplyDraftInput): Promise<InboundLetterDto> {
  assertCan(user, 'INBOUND_REVIEW')
  const existing = await repo.findById(id)
  if (!existing) throw notFound('Обращение не найдено')

  const now = new Date()
  const row = await repo.saveReplyDraft(id, input.text, 'template', now)

  await writeAudit({
    userId: user.id,
    action: 'inbound_letter.reply_draft.edit',
    objectType: 'InboundLetter',
    objectId: id,
    payload: {},
  })

  const universityNames = await withUniversityNames([row])
  return toDto(row, universityNames)
}

// ───────────────────────────────────── Статистика ────────────────────────────

export async function stats(user: CurrentUser): Promise<InboundLetterStatsDto> {
  assertCan(user, 'INBOUND_READ')
  const now = new Date()
  const rows = await repo.findAllGroupStats()
  const byGroup = new Map(rows.map((row) => [row.group, row]))

  const groups: InboundLetterGroupStatsDto[] = INBOUND_LETTER_GROUPS.map((group) => {
    const row = byGroup.get(group)
    if (!row) return { group, totalReviewed: 0, totalCorrect: 0, accuracy: null, sampleEff: 0 }
    const cooled = coolDown(row, now, INBOUND_LETTER_LEARNING.halfLifeDays)
    return {
      group,
      totalReviewed: row.trials,
      totalCorrect: row.successes,
      accuracy: cooled.trialsEff > 0 ? cooled.successesEff / cooled.trialsEff : null,
      sampleEff: cooled.trialsEff,
    }
  })

  return { groups, generatedAt: now.toISOString() }
}
