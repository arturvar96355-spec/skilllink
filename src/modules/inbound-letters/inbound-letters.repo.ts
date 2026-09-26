import { prisma } from '@/shared/db/prisma'
import type { Prisma } from '@/generated/prisma/client'
import type { AiDraftSource } from '@/shared/contracts/ai-assist'
import { buildOrderBy, parseSort, toSkipTake } from '@/shared/http/pagination'
import { OPEN_COOPERATION_STATUSES } from '@/modules/cooperation/cooperation.rules'
import { findCurrentStage } from '@/modules/workflow/workflow.rules'
import { applyEvent } from '@/modules/recommendations/recommendations.learning'
import { INBOUND_LETTER_LEARNING, SIMILAR_EXAMPLES_POOL_LIMIT } from '@/shared/config/inbound-letters.config'
import { domainFromWebsite, emailDomain } from './inbound-letters.match'
import { INBOUND_LETTER_SORT_FIELDS, type InboundLetterListQuery } from './inbound-letters.schema'

type Client = Prisma.TransactionClient | typeof prisma

/** Все поля письма и то немногое из связей, что нужно карточке и списку. */
export const letterSelect = {
  id: true,
  senderEmail: true,
  senderName: true,
  subject: true,
  bodyText: true,
  receivedAt: true,
  source: true,
  messageId: true,
  status: true,
  universityId: true,
  cooperationId: true,
  stageNumber: true,
  group: true,
  action: true,
  detectedUniversityId: true,
  detectedCooperationId: true,
  detectedStageNumber: true,
  detectedGroup: true,
  detectedAction: true,
  confidence: true,
  quotes: true,
  analyzedBy: true,
  analyzedNote: true,
  analyzedAt: true,
  reviewedById: true,
  reviewedAt: true,
  verdict: true,
  reviewComment: true,
  replyDraft: true,
  replyDraftSource: true,
  replyDraftUpdatedAt: true,
  isMock: true,
  createdAt: true,
  updatedAt: true,
  university: { select: { name: true } },
  reviewedBy: { select: { fullName: true } },
  task: {
    select: {
      id: true,
      responsibleId: true,
      status: true,
      title: true,
      createdAt: true,
      responsible: { select: { fullName: true } },
    },
  },
} satisfies Prisma.InboundLetterSelect

export type LetterRow = Prisma.InboundLetterGetPayload<{ select: typeof letterSelect }>

/**
 * Область видимости для MANAGER (решение 170): только письма вузов, где он
 * ответственный — за сам вуз или за найденную связку. ADMIN и HEAD видят все,
 * scope для них — `{}` (без фильтра), тем же приёмом, что `universityScope`
 * у представителя вуза (`shared/auth/permissions.ts`), только по ответственности,
 * а не по роли: письма — общий инструмент, а не отдельный кабинет.
 */
export function managerScope(userId: string): Prisma.InboundLetterWhereInput {
  return { OR: [{ university: { responsibleId: userId } }, { cooperation: { responsibleId: userId } }] }
}

export async function findMany(
  query: InboundLetterListQuery,
  scope: Prisma.InboundLetterWhereInput,
): Promise<{ rows: LetterRow[]; total: number }> {
  const where: Prisma.InboundLetterWhereInput = { ...scope }
  if (query.status?.length) where.status = { in: query.status }
  if (query.group?.length) where.group = { in: query.group }
  if (query.universityId) where.universityId = query.universityId
  if (query.cooperationId) where.cooperationId = query.cooperationId

  const sort = parseSort(query.sort, INBOUND_LETTER_SORT_FIELDS, { field: 'receivedAt', direction: 'desc' })
  const { skip, take } = toSkipTake(query)

  const [rows, total] = await Promise.all([
    prisma.inboundLetter.findMany({ where, select: letterSelect, orderBy: buildOrderBy(sort), skip, take }),
    prisma.inboundLetter.count({ where }),
  ])
  return { rows, total }
}

export async function findById(id: string): Promise<LetterRow | null> {
  return prisma.inboundLetter.findUnique({ where: { id }, select: letterSelect })
}

/** Видно ли письмо менеджеру — по ответственности за вуз или связку (`managerScope`). */
export async function isVisibleTo(id: string, userId: string): Promise<boolean> {
  return (await prisma.inboundLetter.count({ where: { id, ...managerScope(userId) } })) > 0
}

export interface CreateLetterInput {
  senderEmail: string
  senderName: string | null
  subject: string
  bodyText: string
  receivedAt: Date
  source: 'DEMO' | 'EML_UPLOAD'
  messageId: string | null
  isMock?: boolean
}

export async function create(input: CreateLetterInput, client: Client = prisma): Promise<LetterRow> {
  return client.inboundLetter.create({
    data: {
      senderEmail: input.senderEmail,
      senderName: input.senderName,
      subject: input.subject,
      bodyText: input.bodyText,
      receivedAt: input.receivedAt,
      source: input.source,
      messageId: input.messageId,
      isMock: input.isMock ?? false,
    },
    select: letterSelect,
  })
}

// ─────────────────────── Определение вуза, связки, этапа ────────────────────

export interface UniversityDomainCandidate {
  universityId: string
  domains: string[]
}

/** Домены вузов: сайт вуза + почты его контактных лиц. */
export async function findUniversityDomains(): Promise<UniversityDomainCandidate[]> {
  const universities = await prisma.university.findMany({
    where: { archivedAt: null, mergedIntoId: null },
    select: { id: true, website: true, contacts: { select: { email: true } } },
  })
  return universities.map((university) => {
    const domains = new Set<string>()
    const websiteDomain = university.website ? domainFromWebsite(university.website) : null
    if (websiteDomain) domains.add(websiteDomain)
    for (const contact of university.contacts) {
      if (!contact.email) continue
      const domain = emailDomain(contact.email)
      if (domain) domains.add(domain)
    }
    return { universityId: university.id, domains: [...domains] }
  })
}

export interface CooperationStageRef {
  cooperationId: string
  stageNumber: number | null
}

/**
 * Связка вуза, с которой сейчас работают, и её текущий этап: активная, иначе
 * черновик или на паузе (порядок — предпочтение живой работе), самая недавно
 * обновлённая. Несколько открытых связок у вуза — редкость, но не ошибка;
 * письмо привязывается к самой актуальной, сотрудник поправит при «Неверно».
 */
export async function findActiveCooperation(universityId: string): Promise<CooperationStageRef | null> {
  const rows = await prisma.cooperation.findMany({
    where: { universityId, status: { in: [...OPEN_COOPERATION_STATUSES] } },
    select: { id: true, status: true, updatedAt: true, stages: { select: { stageNumber: true, status: true } } },
    orderBy: { updatedAt: 'desc' },
  })
  if (rows.length === 0) return null

  const preferred = rows.find((row) => row.status === 'ACTIVE') ?? rows[0]!
  const current = findCurrentStage(preferred.stages)
  return { cooperationId: preferred.id, stageNumber: current?.stageNumber ?? null }
}

export async function universityName(universityId: string): Promise<string | null> {
  const row = await prisma.university.findUnique({ where: { id: universityId }, select: { name: true } })
  return row?.name ?? null
}

/** Названия вузов по нескольким id одним запросом — карточка письма показывает и действующий, и найденный разбором вуз. */
export async function findUniversityNames(ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const rows = await prisma.university.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } })
  return new Map(rows.map((row) => [row.id, row.name]))
}

export async function assertUniversityExists(universityId: string): Promise<boolean> {
  return (await prisma.university.count({ where: { id: universityId } })) > 0
}

/** Связка принадлежит вузу — проверка перед сохранением ручной правки. */
export async function cooperationBelongsToUniversity(cooperationId: string, universityId: string): Promise<boolean> {
  return (await prisma.cooperation.count({ where: { id: cooperationId, universityId } })) > 0
}

// ─────────────────────────── Похожие письма (few-shot) ──────────────────────

export interface LabeledLetterExample {
  id: string
  text: string
  group: 'STAGE_SHIFT' | 'DOCUMENTS' | 'MEETING' | 'QUESTION' | 'PAUSE_OR_REFUSAL' | 'OTHER'
  action: string
  universityId: string | null
}

/** Прошлые размеченные письма (проверенные сотрудником) — пул для поиска похожих. */
export async function findLabeledExamples(excludeId?: string): Promise<LabeledLetterExample[]> {
  const rows = await prisma.inboundLetter.findMany({
    where: { status: { in: ['CONFIRMED', 'CORRECTED'] }, group: { not: null }, action: { not: null }, id: excludeId ? { not: excludeId } : undefined },
    select: { id: true, subject: true, bodyText: true, group: true, action: true, universityId: true },
    orderBy: { updatedAt: 'desc' },
    take: SIMILAR_EXAMPLES_POOL_LIMIT,
  })
  return rows
    .filter((row): row is typeof row & { group: NonNullable<typeof row.group>; action: string } => row.group !== null && row.action !== null)
    .map((row) => ({
      id: row.id,
      text: `${row.subject}\n${row.bodyText}`,
      group: row.group,
      action: row.action,
      universityId: row.universityId,
    }))
}

// ─────────────────────────────── Разбор ──────────────────────────────────────

export interface AnalysisUpdateInput {
  universityId: string | null
  cooperationId: string | null
  stageNumber: number | null
  group: 'STAGE_SHIFT' | 'DOCUMENTS' | 'MEETING' | 'QUESTION' | 'PAUSE_OR_REFUSAL' | 'OTHER'
  action: string
  confidence: number
  quotes: string[]
  analyzedBy: 'MODEL' | 'RULES'
  analyzedNote: string | null
  analyzedAt: Date
}

/**
 * Сохраняет разбор — и снимок (`detected*`), и действующую версию: до проверки
 * они совпадают. Статус переходит в `ANALYZED`, если письмо ещё не было проверено.
 */
export async function saveAnalysis(id: string, input: AnalysisUpdateInput): Promise<LetterRow> {
  return prisma.inboundLetter.update({
    where: { id },
    data: {
      status: 'ANALYZED',
      universityId: input.universityId,
      cooperationId: input.cooperationId,
      stageNumber: input.stageNumber,
      group: input.group,
      action: input.action,
      detectedUniversityId: input.universityId,
      detectedCooperationId: input.cooperationId,
      detectedStageNumber: input.stageNumber,
      detectedGroup: input.group,
      detectedAction: input.action,
      confidence: input.confidence,
      quotes: input.quotes,
      analyzedBy: input.analyzedBy,
      analyzedNote: input.analyzedNote,
      analyzedAt: input.analyzedAt,
    },
    select: letterSelect,
  })
}

// ─────────────────────────────── Проверка ────────────────────────────────────

export interface ReviewUpdateInput {
  status: 'CONFIRMED' | 'CORRECTED'
  verdict: 'CORRECT' | 'INCORRECT'
  universityId: string
  cooperationId: string | null
  stageNumber: number | null
  group: 'STAGE_SHIFT' | 'DOCUMENTS' | 'MEETING' | 'QUESTION' | 'PAUSE_OR_REFUSAL' | 'OTHER'
  action: string
  reviewedById: string
  reviewedAt: Date
  comment: string | null
}

export interface TaskCreateInput {
  letterId: string
  universityId: string
  cooperationId: string | null
  responsibleId: string | null
  title: string
  description: string
  group: 'STAGE_SHIFT' | 'DOCUMENTS' | 'MEETING' | 'QUESTION' | 'PAUSE_OR_REFUSAL' | 'OTHER'
  action: string
}

export async function saveReviewAndCreateTask(review: ReviewUpdateInput, task: TaskCreateInput): Promise<LetterRow> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.inboundLetter.update({
      where: { id: task.letterId },
      data: {
        status: review.status,
        verdict: review.verdict,
        universityId: review.universityId,
        cooperationId: review.cooperationId,
        stageNumber: review.stageNumber,
        group: review.group,
        action: review.action,
        reviewedById: review.reviewedById,
        reviewedAt: review.reviewedAt,
        reviewComment: review.comment,
      },
      select: letterSelect,
    })
    await tx.inboundLetterTask.create({
      data: {
        letterId: task.letterId,
        universityId: task.universityId,
        cooperationId: task.cooperationId,
        responsibleId: task.responsibleId,
        title: task.title,
        description: task.description,
        group: task.group,
        action: task.action,
      },
    })
    return row
  })
}

export async function findResponsible(
  universityId: string,
  cooperationId: string | null,
): Promise<string | null> {
  if (cooperationId) {
    const cooperation = await prisma.cooperation.findUnique({ where: { id: cooperationId }, select: { responsibleId: true } })
    if (cooperation?.responsibleId) return cooperation.responsibleId
  }
  const university = await prisma.university.findUnique({ where: { id: universityId }, select: { responsibleId: true } })
  return university?.responsibleId ?? null
}

// ────────────────────────────── Отклонение (спам) ────────────────────────────

export async function dismiss(id: string, userId: string, now: Date, comment: string | null): Promise<LetterRow> {
  return prisma.inboundLetter.update({
    where: { id },
    data: { status: 'DISMISSED', reviewedById: userId, reviewedAt: now, reviewComment: comment },
    select: letterSelect,
  })
}

// ─────────────────────────────── Черновик ответа ─────────────────────────────

export async function saveReplyDraft(id: string, text: string, source: AiDraftSource, now: Date): Promise<LetterRow> {
  return prisma.inboundLetter.update({
    where: { id },
    data: { replyDraft: text, replyDraftSource: source, replyDraftUpdatedAt: now },
    select: letterSelect,
  })
}

// ─────────────────────────── Статистика по группам ───────────────────────────

export interface GroupStatsRow {
  group: 'STAGE_SHIFT' | 'DOCUMENTS' | 'MEETING' | 'QUESTION' | 'PAUSE_OR_REFUSAL' | 'OTHER'
  trials: number
  successes: number
  trialsEff: number
  successesEff: number
  effUpdatedAt: Date
}

export async function findAllGroupStats(): Promise<GroupStatsRow[]> {
  return prisma.inboundLetterGroupStats.findMany()
}

export async function findGroupStats(group: GroupStatsRow['group']): Promise<GroupStatsRow | null> {
  return prisma.inboundLetterGroupStats.findUnique({ where: { group } })
}

/**
 * Запись события точности — простое чтение-запись (не атомарный `UPSERT` с
 * затуханием в SQL, в отличие от `recommendations.stats.repo.ts`): проверка письма —
 * редкое, поштучное действие сотрудника, а не пакетная пересборка, конкурентная
 * запись по одной и той же группе внутри одной секунды практически не встречается.
 */
export async function recordGroupEvent(
  group: GroupStatsRow['group'],
  event: { trials: number; successes: number },
  now: Date,
): Promise<void> {
  const existing = await findGroupStats(group)
  const next = applyEvent(existing, { at: now, trials: event.trials, successes: event.successes }, INBOUND_LETTER_LEARNING.halfLifeDays)
  await prisma.inboundLetterGroupStats.upsert({
    where: { group },
    create: {
      group,
      trials: next.trials,
      successes: next.successes,
      trialsEff: next.trialsEff,
      successesEff: next.successesEff,
      effUpdatedAt: next.effUpdatedAt,
    },
    update: {
      trials: next.trials,
      successes: next.successes,
      trialsEff: next.trialsEff,
      successesEff: next.successesEff,
      effUpdatedAt: next.effUpdatedAt,
    },
  })
}
