import { prisma } from '@/shared/db/prisma'
import { TIE_BREAKER, toSkipTake } from '@/shared/http/pagination'
import { OPEN_COOPERATION_STATUSES } from '@/shared/contracts/enums'
import type { Prisma } from '@/generated/prisma/client'
import type {
  DsarRequestChannel,
  DsarRequestKind,
  DsarSubjectType,
} from '@/shared/contracts/dsar'
import type { DsarEntry, DsarSubjectRef } from './dsar.registry'
import { entryWhere } from './dsar.registry'
import type { DsarRequestListQuery } from './dsar.schema'

type Client = Prisma.TransactionClient | typeof prisma

/**
 * Модель реестра читается и меняется одним общим путём — через делегат Prisma
 * по имени модели. Типы делегатов у моделей разные, а реестр — данные, поэтому
 * здесь нужен узкий общий интерфейс, а не 24 ветки `switch`.
 */
interface GenericDelegate {
  findMany(args: Record<string, unknown>): Promise<Array<Record<string, unknown>>>
  count(args: Record<string, unknown>): Promise<number>
  deleteMany(args: Record<string, unknown>): Promise<{ count: number }>
  updateMany(args: Record<string, unknown>): Promise<{ count: number }>
}

function delegateOf(client: Client, model: Prisma.ModelName): GenericDelegate {
  const name = model.charAt(0).toLowerCase() + model.slice(1)
  const delegate = (client as unknown as Record<string, GenericDelegate | undefined>)[name]
  if (!delegate) throw new Error(`Нет делегата Prisma для модели ${model}`)
  return delegate
}

/** Раздел выгрузки: строки не больше предела и настоящее общее число. */
export async function loadSection(
  entry: DsarEntry,
  subject: DsarSubjectRef,
  limit: number,
): Promise<{ total: number; items: Array<Record<string, unknown>> }> {
  const where = entryWhere(entry, subject)
  if (where === null) return { total: 0, items: [] }
  const delegate = delegateOf(prisma, entry.model)
  const [items, total] = await Promise.all([
    delegate.findMany({ where, select: entry.select, orderBy: [entry.orderBy, entry.tieBreaker ?? TIE_BREAKER], take: limit }),
    delegate.count({ where }),
  ])
  return { total, items }
}

/**
 * Обезличивание по реестру в транзакции вызывающего: `delete` удаляет строки,
 * `redact` заменяет поля заглушкой, `keep` только считает. Отдаёт число строк по разделам.
 */
export async function applyErase(
  tx: Prisma.TransactionClient,
  entries: readonly DsarEntry[],
  subject: DsarSubjectRef,
): Promise<Record<string, { action: DsarEntry['erase']; rows: number }>> {
  const result: Record<string, { action: DsarEntry['erase']; rows: number }> = {}
  // Сначала удаления, потом замены: удалённое заглушкой не переписывается.
  const ordered = [...entries].sort((a, b) => rank(a.erase) - rank(b.erase))
  for (const entry of ordered) {
    const where = entryWhere(entry, subject)
    if (where === null) {
      result[entry.section] = { action: entry.erase, rows: 0 }
      continue
    }
    const delegate = delegateOf(tx, entry.model)
    let rows: number
    if (entry.erase === 'delete') {
      rows = (await delegate.deleteMany({ where })).count
    } else if (entry.erase === 'redact') {
      if (!entry.redact) throw new Error(`Раздел ${entry.section}: redact без набора полей`)
      rows = (await delegate.updateMany({ where, data: entry.redact(subject) })).count
    } else {
      rows = await delegate.count({ where })
    }
    result[entry.section] = { action: entry.erase, rows }
  }
  return result
}

function rank(action: DsarEntry['erase']): number {
  return action === 'delete' ? 0 : action === 'redact' ? 1 : 2
}

export async function inTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn)
}

// ── Субъекты ────────────────────────────────────────────────────────────────

export async function findUserSubject(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, fullName: true, role: true, isActive: true },
  })
}

export async function findContactSubject(id: string) {
  return prisma.contact.findUnique({
    where: { id },
    select: {
      id: true,
      universityId: true,
      fullName: true,
      position: true,
      email: true,
      phone: true,
      isPrimary: true,
      legalBasis: true,
    },
  })
}

/** Есть ли у пользователя привязка Telegram и ссылка календаря — для списка получателей. */
export async function findUserChannels(userId: string) {
  const [telegram, calendar] = await Promise.all([
    prisma.telegramLink.count({ where: { userId } }),
    prisma.calendarFeed.count({ where: { userId } }),
  ])
  return { telegram: telegram > 0, calendar: calendar > 0 }
}

/**
 * Обезличивание пользователя целиком — в одной транзакции со строками
 * администраторов под `FOR UPDATE`: «последний администратор» не обходится
 * двумя одновременными запросами (как в auth.repo.updateWithGuard).
 */
export async function withUserLock<T>(
  id: string,
  fn: (
    tx: Prisma.TransactionClient,
    facts: {
      target: { id: string; email: string; fullName: string; role: string; isActive: boolean } | null
      otherActiveAdmins: number
      openWork: { cooperations: number; stages: number }
    },
  ) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} OR (role = 'ADMIN' AND is_active) FOR UPDATE`
    const target = await tx.user.findUnique({
      where: { id },
      select: { id: true, email: true, fullName: true, role: true, isActive: true },
    })
    const otherActiveAdmins = await tx.user.count({
      where: { role: 'ADMIN', isActive: true, id: { not: id } },
    })
    const openCooperation = { status: { in: [...OPEN_COOPERATION_STATUSES] } }
    const cooperations = await tx.cooperation.count({ where: { responsibleId: id, ...openCooperation } })
    const stages = await tx.workflowStage.count({
      where: {
        responsibleId: id,
        status: { in: ['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED'] },
        cooperation: openCooperation,
      },
    })
    return fn(tx, { target, otherActiveAdmins, openWork: { cooperations, stages } })
  })
}

/** Транзакция с блокировкой строки контакта: два обезличивания не пишут две записи журнала. */
export async function withContactLock<T>(
  id: string,
  fn: (
    tx: Prisma.TransactionClient,
    contact: { id: string; universityId: string; fullName: string; position: string | null; email: string | null; phone: string | null; isPrimary: boolean } | null,
  ) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM contacts WHERE id = ${id} FOR UPDATE`
    const contact = await tx.contact.findUnique({
      where: { id },
      select: { id: true, universityId: true, fullName: true, position: true, email: true, phone: true, isPrimary: true },
    })
    return fn(tx, contact)
  })
}

// ── Реестр запросов ─────────────────────────────────────────────────────────

const requestSelect = {
  id: true,
  subjectType: true,
  subjectId: true,
  kind: true,
  channel: true,
  status: true,
  requestedAt: true,
  dueAt: true,
  completedAt: true,
  summary: true,
  requestedBy: { select: { id: true, fullName: true, role: true } },
} satisfies Prisma.DsarRequestSelect

export type DsarRequestRow = Prisma.DsarRequestGetPayload<{ select: typeof requestSelect }>

export async function listRequests(query: DsarRequestListQuery, now: Date) {
  const where: Prisma.DsarRequestWhereInput = {}
  if (query.status) where.status = query.status
  if (query.kind) where.kind = query.kind
  if (query.subjectType) where.subjectType = query.subjectType
  if (query.subjectId) where.subjectId = query.subjectId
  if (query.overdue === true) {
    where.status = 'OPEN'
    where.dueAt = { lt: now }
  }
  const [rows, total] = await Promise.all([
    prisma.dsarRequest.findMany({
      where,
      select: requestSelect,
      orderBy: [{ requestedAt: 'desc' }, TIE_BREAKER],
      ...toSkipTake(query),
    }),
    prisma.dsarRequest.count({ where }),
  ])
  return { rows, total }
}

export async function findOpenRequest(
  subjectType: DsarSubjectType,
  subjectId: string,
  kind: DsarRequestKind,
  client: Client = prisma,
) {
  return client.dsarRequest.findFirst({
    where: { subjectType, subjectId, kind, status: 'OPEN' },
    orderBy: [{ requestedAt: 'asc' }, TIE_BREAKER],
    select: requestSelect,
  })
}

export async function createRequest(
  data: {
    subjectType: DsarSubjectType
    subjectId: string
    kind: DsarRequestKind
    channel: DsarRequestChannel
    requestedById: string
    requestedAt: Date
    dueAt: Date
    ip?: string | null
  },
  client: Client = prisma,
): Promise<DsarRequestRow> {
  return client.dsarRequest.create({ data, select: requestSelect })
}

/** Закрыть все открытые запросы этого вида о субъекте. Отдаёт их номера. */
export async function completeOpenRequests(
  tx: Prisma.TransactionClient,
  subjectType: DsarSubjectType,
  subjectId: string,
  kind: DsarRequestKind,
  completedAt: Date,
  summary: Prisma.InputJsonValue,
): Promise<string[]> {
  const open = await tx.dsarRequest.findMany({
    where: { subjectType, subjectId, kind, status: 'OPEN' },
    select: { id: true },
    orderBy: [{ requestedAt: 'asc' }, TIE_BREAKER],
  })
  if (open.length === 0) return []
  await tx.dsarRequest.updateMany({
    where: { id: { in: open.map((row) => row.id) } },
    data: { status: 'COMPLETED', completedAt, summary },
  })
  return open.map((row) => row.id)
}

/** Сразу исполненный запрос: выгрузка без письма или из личного кабинета. */
export async function createCompletedRequest(
  tx: Prisma.TransactionClient,
  data: {
    subjectType: DsarSubjectType
    subjectId: string
    kind: DsarRequestKind
    channel: DsarRequestChannel
    requestedById: string
    requestedAt: Date
    dueAt: Date
    ip?: string | null
    summary: Prisma.InputJsonValue
  },
): Promise<string> {
  const row = await tx.dsarRequest.create({
    data: { ...data, status: 'COMPLETED', completedAt: data.requestedAt },
    select: { id: true },
  })
  return row.id
}

/**
 * Последняя самостоятельная выгрузка пользователя — под рекомендательной
 * блокировкой транзакции: два одновременных нажатия не пройдут оба.
 */
export async function withSelfExportLock<T>(
  userId: string,
  fn: (tx: Prisma.TransactionClient, lastAt: Date | null) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dsar-self:${userId}`}))`
    const last = await tx.dsarRequest.findFirst({
      where: { subjectType: 'USER', subjectId: userId, channel: 'SELF_SERVICE' },
      orderBy: [{ requestedAt: 'desc' }, TIE_BREAKER],
      select: { requestedAt: true },
    })
    return fn(tx, last?.requestedAt ?? null)
  })
}

export async function findLastSelfExport(userId: string): Promise<Date | null> {
  const last = await prisma.dsarRequest.findFirst({
    where: { subjectType: 'USER', subjectId: userId, channel: 'SELF_SERVICE' },
    orderBy: [{ requestedAt: 'desc' }, TIE_BREAKER],
    select: { requestedAt: true },
  })
  return last?.requestedAt ?? null
}
