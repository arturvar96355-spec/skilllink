import { assertCan } from '@/shared/auth/permissions'
import { writeAudit } from '@/shared/audit/audit'
import { conflict, notFound, validationError } from '@/shared/http/errors'
import { pageMeta } from '@/shared/http/pagination'
import { isSharedDemoAccount, SHARED_DEMO_ACCOUNT_REFUSAL } from '@/shared/config/auth.config'
import {
  DSAR_LEGAL,
  DSAR_LIMITS,
  DSAR_OPERATOR,
  DSAR_OPTIONAL_TRANSFERS,
} from '@/shared/config/dsar.config'
import { CONTACT_LEGAL_BASIS_LABELS } from '@/shared/contracts/labels'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { PageMeta } from '@/shared/contracts/common'
import type {
  DsarEraseResultDto,
  DsarExportDto,
  DsarRequestChannel,
  DsarRequestDto,
  DsarSectionDto,
  DsarSubjectType,
  DsarTransferDto,
} from '@/shared/contracts/dsar'
import type { Prisma } from '@/generated/prisma/client'
import { toIso, toIsoRequired } from '@/shared/utils/date'
import { isAnonymizedContact } from '@/modules/universities/universities.rules'
import { describeOpenWork } from '@/modules/auth/auth.rules'
import * as repo from './dsar.repo'
import { DSAR_REGISTRY, type DsarEntry, type DsarSubjectRef } from './dsar.registry'
import {
  confirmMatches,
  dueDate,
  isErasedUser,
  selfExportRetryAfter,
  withoutClientAddress,
} from './dsar.rules'
import type { CreateDsarRequestBody, DsarRequestListQuery, EraseSubjectBody } from './dsar.schema'

/**
 * «Всё о субъекте» по 152-ФЗ (решение 116): выгрузка сведений (ст. 14),
 * обезличивание по запросу (ст. 20, 21) и реестр запросов субъектов.
 *
 * Состав выгрузки и обезличивания задаёт реестр `DSAR_REGISTRY`, а не этот файл:
 * здесь только порядок действий, права и журнал.
 */

const RECEIVED_AT_MAX_AGE_DAYS = 30

// ── Выгрузка ────────────────────────────────────────────────────────────────

interface LoadedSubject {
  ref: DsarSubjectRef
  displayName: string
  erased: boolean
  legalBasis: string[]
  recipients: DsarTransferDto[]
}

async function loadUserSubject(id: string): Promise<LoadedSubject | null> {
  const user = await repo.findUserSubject(id)
  if (!user) return null
  const erased = isErasedUser(user)
  const channels = await repo.findUserChannels(id)
  const legal = DSAR_LEGAL.USER.legalBasis
  return {
    ref: { kind: 'USER', id, name: erased ? null : user.fullName },
    displayName: user.fullName,
    erased,
    legalBasis: [
      user.role === 'UNIVERSITY_REP' ? legal.universityRep : legal.staff,
      legal.security,
    ],
    recipients: [
      ...DSAR_LEGAL.USER.transfers,
      ...(channels.telegram ? [DSAR_OPTIONAL_TRANSFERS.telegram] : []),
      ...(channels.calendar ? [DSAR_OPTIONAL_TRANSFERS.calendar] : []),
    ],
  }
}

async function loadContactSubject(id: string): Promise<LoadedSubject | null> {
  const contact = await repo.findContactSubject(id)
  if (!contact) return null
  const erased = isAnonymizedContact(contact)
  return {
    ref: { kind: 'CONTACT', id, name: erased ? null : contact.fullName },
    displayName: contact.fullName,
    erased,
    legalBasis: [
      contact.legalBasis
        ? `зафиксировано: ${CONTACT_LEGAL_BASIS_LABELS[contact.legalBasis]} (документ — в разделе profile)`
        : 'не зафиксировано в системе; по оценке оператора — п. 7 ч. 1 ст. 6 152-ФЗ: законный интерес, договор с вузом',
    ],
    recipients: [...DSAR_LEGAL.CONTACT.transfers],
  }
}

async function loadSubject(type: DsarSubjectType, id: string): Promise<LoadedSubject | null> {
  return type === 'USER' ? loadUserSubject(id) : loadContactSubject(id)
}

function notFoundSubject(type: DsarSubjectType) {
  return notFound(type === 'USER' ? 'Пользователь не найден' : 'Контакт не найден')
}

async function buildSection(entry: DsarEntry, subject: DsarSubjectRef): Promise<DsarSectionDto> {
  const limit = DSAR_LIMITS.itemsPerSection
  const { total, items } = await repo.loadSection(entry, subject, limit)
  const shaped =
    entry.trail === 'aboutSubject'
      ? items.map((item) => ({ ...item, payload: withoutClientAddress(item.payload) }))
      : items
  return {
    title: entry.title,
    model: entry.model,
    total,
    returned: shaped.length,
    truncated: total > shaped.length,
    onErase: entry.erase,
    reason: entry.reason,
    items: shaped.map(toPlain),
  }
}

/** Даты — строками ISO, как везде в API; вложенные объекты — рекурсивно. */
function toPlain(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

/** Собрать выгрузку. Ничего не пишет: запрос и журнал — у вызывающего. */
export async function buildExport(
  type: DsarSubjectType,
  subject: LoadedSubject,
  generatedBy: { id: string; role: string; self: boolean },
  now: Date,
): Promise<DsarExportDto> {
  const entries = DSAR_REGISTRY[type]
  const data: Record<string, DsarSectionDto> = {}
  let byActor: DsarSectionDto | null = null
  let aboutSubject: DsarSectionDto | null = null
  const counts: Record<string, number> = {}

  // По очереди, а не все разом: разделов почти двадцать, пул соединений небольшой.
  for (const entry of entries) {
    const section = await buildSection(entry, subject.ref)
    counts[entry.section] = section.total
    if (entry.trail === 'byActor') byActor = section
    else if (entry.trail === 'aboutSubject') aboutSubject = section
    else data[entry.section] = section
  }

  const legal = DSAR_LEGAL[type]
  return {
    subject: { type, id: subject.ref.id, displayName: subject.displayName, erased: subject.erased },
    generatedAt: now.toISOString(),
    generatedBy,
    requestId: null,
    operator: { ...DSAR_OPERATOR },
    purposes: legal.purposes,
    legalBasis: subject.legalBasis,
    categories: legal.categories,
    sources: legal.sources,
    processingMethods: legal.processingMethods,
    storageLocation: legal.storageLocation,
    recipients: subject.recipients,
    retention: legal.retention,
    rights: legal.rights,
    data,
    auditTrail: {
      byActor,
      aboutSubject: aboutSubject ?? emptySection('Действия над субъектом'),
    },
    counts,
    notes: [
      `В каждом разделе не больше ${DSAR_LIMITS.itemsPerSection} записей, новые сверху; total — настоящее число.`,
      'Свободный текст (комментарии, результаты, заметки) не выгружается: в нём бывают ПД третьих лиц. ' +
        'Его проверяют вручную по разделам выгрузки.',
      'Кто из работников оператора действовал, указано идентификатором и ролью: сведения о работниках ' +
        'оператора субъекту не предоставляются (п. 4 ч. 7 ст. 14 152-ФЗ).',
      'Журнал фиксирует изменения, выгрузки и входы; просмотры карточек не журналируются.',
    ],
  }
}

function emptySection(title: string): DsarSectionDto {
  return { title, model: 'AuditLog', total: 0, returned: 0, truncated: false, onErase: 'keep', reason: '', items: [] }
}

/** Итог выгрузки для реестра и журнала: только числа. */
function exportSummary(result: DsarExportDto): Prisma.InputJsonObject {
  return { counts: result.counts }
}

/**
 * Выгрузка «всё о субъекте» администратором. Закрывает открытые запросы
 * субъекта на сведения; если их нет — регистрирует исполненный запрос
 * (канал ADMIN), чтобы любая выдача сведений была в реестре.
 */
export async function exportSubject(
  user: CurrentUser,
  type: DsarSubjectType,
  id: string,
  now: Date = new Date(),
): Promise<DsarExportDto> {
  assertCan(user, 'DSAR_MANAGE')
  const subject = await loadSubject(type, id)
  if (!subject) throw notFoundSubject(type)

  const result = await buildExport(type, subject, { id: user.id, role: user.role, self: false }, now)
  const summary = exportSummary(result)

  // Открытыми бывают только запросы по письму: выгрузка без письма и из кабинета
  // регистрируются сразу исполненными.
  const { requestId, channel } = await repo.inTransaction(async (tx) => {
    const closed = await repo.completeOpenRequests(tx, type, id, 'EXPORT', now, summary)
    if (closed.length > 0) return { requestId: closed[0]!, channel: 'LETTER' as DsarRequestChannel }
    const created = await repo.createCompletedRequest(tx, {
      subjectType: type,
      subjectId: id,
      kind: 'EXPORT',
      channel: 'ADMIN',
      requestedById: user.id,
      requestedAt: now,
      dueAt: dueDate('EXPORT', now),
      summary,
    })
    return { requestId: created, channel: 'ADMIN' as DsarRequestChannel }
  })

  await writeAudit({
    userId: user.id,
    action: 'dsar.exported',
    objectType: type === 'USER' ? 'User' : 'Contact',
    objectId: id,
    payload: { requestId, channel, sections: Object.keys(result.counts).length },
  })
  return { ...result, requestId }
}

/**
 * Пользователь выгружает свои данные сам: тот же сборщик, субъект — он.
 * Не чаще раза в `selfExportIntervalMinutes`: каждая выгрузка — строка реестра
 * запросов, по ней и считается частота (общий ограничитель запросов — отдельно).
 */
export async function exportOwnData(
  user: CurrentUser,
  context: { address: string | null },
  now: Date = new Date(),
): Promise<DsarExportDto> {
  const interval = DSAR_LIMITS.selfExportIntervalMinutes
  const early = selfExportRetryAfter(await repo.findLastSelfExport(user.id), now, interval)
  if (early > 0) throw tooSoon(early)

  const subject = await loadUserSubject(user.id)
  if (!subject) throw notFound('Пользователь не найден')
  const result = await buildExport('USER', subject, { id: user.id, role: user.role, self: true }, now)
  const summary = exportSummary(result)

  // Проверка ещё раз — под блокировкой: два одновременных нажатия не пройдут оба.
  const requestId = await repo.withSelfExportLock(user.id, async (tx, lastAt) => {
    const retry = selfExportRetryAfter(lastAt, now, interval)
    if (retry > 0) throw tooSoon(retry)
    return repo.createCompletedRequest(tx, {
      subjectType: 'USER',
      subjectId: user.id,
      kind: 'EXPORT',
      channel: 'SELF_SERVICE',
      requestedById: user.id,
      requestedAt: now,
      dueAt: dueDate('EXPORT', now),
      ip: context.address,
      summary,
    })
  })

  await writeAudit({
    userId: user.id,
    action: 'dsar.exported',
    objectType: 'User',
    objectId: user.id,
    payload: { requestId, channel: 'SELF_SERVICE', sections: Object.keys(result.counts).length },
  })
  return { ...result, requestId }
}

function tooSoon(retryAfterSeconds: number) {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60))
  return conflict(`Свои данные можно выгружать не чаще раза в ${DSAR_LIMITS.selfExportIntervalMinutes} мин. Повторите через ${minutes} мин.`, {
    retryAfterSeconds,
  })
}

// ── Обезличивание ───────────────────────────────────────────────────────────

/**
 * Обезличить пользователя по запросу субъекта. Необратимо, только администратор,
 * с подтверждением логином. В одной транзакции по реестру: ФИО, почта, должность —
 * заглушка, пароль стёрт, учётная запись заблокирована, выданные сессии отозваны
 * (версия сессий +1), ссылка календаря и привязка Telegram удалены. Ссылки из
 * связок, этапов, истории и журнала остаются — на обезличенную запись.
 *
 * Нельзя: себя, последнего действующего администратора, общую демо-учётку и того,
 * за кем открытая работа (сначала передать связки — как при смене роли).
 */
export async function eraseUser(
  user: CurrentUser,
  id: string,
  input: EraseSubjectBody,
  now: Date = new Date(),
): Promise<DsarEraseResultDto> {
  assertCan(user, 'DSAR_MANAGE')
  if (id === user.id) {
    throw conflict('Собственную учётную запись обезличить нельзя: это сделает другой администратор')
  }

  return repo.withUserLock(id, async (tx, { target, otherActiveAdmins, openWork }) => {
    if (!target) throw notFound('Пользователь не найден')

    if (isErasedUser(target)) {
      const closed = await repo.completeOpenRequests(tx, 'USER', id, 'ERASE', now, { alreadyErased: true })
      return { subject: { type: 'USER', id }, alreadyErased: true, erasedAt: now.toISOString(), requestId: closed[0] ?? null, sections: {} }
    }
    if (isSharedDemoAccount(target.email)) throw conflict(SHARED_DEMO_ACCOUNT_REFUSAL)
    if (!confirmMatches(input.confirm, target.email)) {
      throw validationError('Подтверждение не совпадает', [
        { field: 'confirm', message: 'Введите логин (почту) обезличиваемого пользователя' },
      ])
    }
    if (target.role === 'ADMIN' && target.isActive && otherActiveAdmins === 0) {
      throw conflict('Это последний действующий администратор: без него некому управлять системой')
    }
    if (openWork.cooperations + openWork.stages > 0) {
      throw conflict(
        `Сначала передайте связки: сотрудник отвечает за ${describeOpenWork(openWork)}`,
        { openCooperations: openWork.cooperations, openStages: openWork.stages },
      )
    }

    const subject: DsarSubjectRef = { kind: 'USER', id, name: target.fullName }
    const sections = await repo.applyErase(tx, DSAR_REGISTRY.USER, subject)

    // Доступ без сессии закрывается теми же записями журнала, что и при блокировке.
    if ((sections.telegramLink?.rows ?? 0) > 0) {
      await writeAudit(
        { userId: user.id, action: 'telegram.unlink', objectType: 'User', objectId: id, payload: { source: 'dsar.erase' } },
        tx,
      )
    }
    if ((sections.calendarFeed?.rows ?? 0) > 0) {
      await writeAudit(
        { userId: user.id, action: 'calendar.revoke', objectType: 'User', objectId: id, payload: { reason: 'dsar.erase' } },
        tx,
      )
    }
    if (target.isActive) {
      await writeAudit({ userId: user.id, action: 'user.block', objectType: 'User', objectId: id, payload: { reason: 'dsar.erase' } }, tx)
    }

    const requestId = await closeEraseRequests(tx, user, 'USER', id, sections, now)
    await writeAudit(
      {
        userId: user.id,
        action: 'dsar.erased',
        objectType: 'User',
        objectId: id,
        payload: { requestId, rows: rowCounts(sections) },
      },
      tx,
    )
    return { subject: { type: 'USER', id }, alreadyErased: false, erasedAt: now.toISOString(), requestId, sections }
  })
}

/**
 * Обезличить контактное лицо вуза по запросу субъекта: тот же набор полей, что
 * у кнопки в карточке вуза и отзыва согласия (решения 88, 111), плюс закрытие
 * запроса в реестре. Подтверждение — ФИО контакта.
 */
export async function eraseContact(
  user: CurrentUser,
  id: string,
  input: EraseSubjectBody,
  now: Date = new Date(),
): Promise<DsarEraseResultDto> {
  assertCan(user, 'DSAR_MANAGE')

  return repo.withContactLock(id, async (tx, contact) => {
    if (!contact) throw notFound('Контакт не найден')

    if (isAnonymizedContact(contact)) {
      const closed = await repo.completeOpenRequests(tx, 'CONTACT', id, 'ERASE', now, { alreadyErased: true })
      return { subject: { type: 'CONTACT', id }, alreadyErased: true, erasedAt: now.toISOString(), requestId: closed[0] ?? null, sections: {} }
    }
    if (!confirmMatches(input.confirm, contact.fullName)) {
      throw validationError('Подтверждение не совпадает', [
        { field: 'confirm', message: 'Введите ФИО обезличиваемого контакта' },
      ])
    }

    const subject: DsarSubjectRef = { kind: 'CONTACT', id, name: contact.fullName }
    const sections = await repo.applyErase(tx, DSAR_REGISTRY.CONTACT, subject)

    // Та же запись, что у обезличивания в карточке: выгрузка для акта по contact.anonymize полна.
    await writeAudit(
      {
        userId: user.id,
        action: 'contact.anonymize',
        objectType: 'Contact',
        objectId: id,
        payload: { universityId: contact.universityId, wasPrimary: contact.isPrimary, reason: 'dsar.erase' },
      },
      tx,
    )
    const requestId = await closeEraseRequests(tx, user, 'CONTACT', id, sections, now)
    await writeAudit(
      {
        userId: user.id,
        action: 'dsar.erased',
        objectType: 'Contact',
        objectId: id,
        payload: { requestId, rows: rowCounts(sections) },
      },
      tx,
    )
    return { subject: { type: 'CONTACT', id }, alreadyErased: false, erasedAt: now.toISOString(), requestId, sections }
  })
}

function rowCounts(sections: DsarEraseResultDto['sections']): Record<string, number> {
  return Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, value.rows]))
}

async function closeEraseRequests(
  tx: Prisma.TransactionClient,
  user: CurrentUser,
  type: DsarSubjectType,
  id: string,
  sections: DsarEraseResultDto['sections'],
  now: Date,
): Promise<string> {
  const summary = { rows: rowCounts(sections) }
  const closed = await repo.completeOpenRequests(tx, type, id, 'ERASE', now, summary)
  if (closed.length > 0) return closed[0]!
  return repo.createCompletedRequest(tx, {
    subjectType: type,
    subjectId: id,
    kind: 'ERASE',
    channel: 'ADMIN',
    requestedById: user.id,
    requestedAt: now,
    dueAt: dueDate('ERASE', now),
    summary,
  })
}

// ── Реестр запросов ─────────────────────────────────────────────────────────

function toRequestDto(row: repo.DsarRequestRow, now: Date): DsarRequestDto {
  return {
    id: row.id,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    kind: row.kind,
    channel: row.channel,
    status: row.status,
    requestedBy: row.requestedBy,
    requestedAt: toIsoRequired(row.requestedAt),
    dueAt: toIsoRequired(row.dueAt),
    completedAt: toIso(row.completedAt),
    overdue: row.status === 'OPEN' && row.dueAt.getTime() < now.getTime(),
    summary: (row.summary as Record<string, unknown> | null) ?? null,
  }
}

export async function listRequests(
  user: CurrentUser,
  query: DsarRequestListQuery,
  now: Date = new Date(),
): Promise<{ data: DsarRequestDto[]; meta: PageMeta }> {
  assertCan(user, 'DSAR_MANAGE')
  const { rows, total } = await repo.listRequests(query, now)
  return { data: rows.map((row) => toRequestDto(row, now)), meta: pageMeta(query, total) }
}

/**
 * Зарегистрировать запрос субъекта, пришедший письмом: срок считается от даты
 * получения. Открытый запрос того же вида о том же субъекте — 409 с его номером:
 * второе письмо того же человека срок не сдвигает.
 */
export async function registerRequest(
  user: CurrentUser,
  input: CreateDsarRequestBody,
  now: Date = new Date(),
): Promise<DsarRequestDto> {
  assertCan(user, 'DSAR_MANAGE')

  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : now
  if (receivedAt.getTime() > now.getTime()) {
    throw validationError('Дата получения в будущем', [{ field: 'receivedAt', message: 'Не позже текущего момента' }])
  }
  if (now.getTime() - receivedAt.getTime() > RECEIVED_AT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) {
    throw validationError('Слишком старая дата получения', [
      { field: 'receivedAt', message: `Не раньше чем ${RECEIVED_AT_MAX_AGE_DAYS} дней назад` },
    ])
  }

  const subject = await loadSubject(input.subjectType, input.subjectId)
  if (!subject) {
    throw validationError('Субъект не найден', [
      { field: 'subjectId', message: input.subjectType === 'USER' ? 'Нет такого пользователя' : 'Нет такого контакта' },
    ])
  }

  const open = await repo.findOpenRequest(input.subjectType, input.subjectId, input.kind)
  if (open) {
    throw conflict('По этому субъекту уже есть открытый запрос того же вида', { requestId: open.id })
  }

  const row = await repo.createRequest({
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    kind: input.kind,
    channel: 'LETTER',
    requestedById: user.id,
    requestedAt: receivedAt,
    dueAt: dueDate(input.kind, receivedAt),
  })
  await writeAudit({
    userId: user.id,
    action: 'dsar.requested',
    objectType: input.subjectType === 'USER' ? 'User' : 'Contact',
    objectId: input.subjectId,
    payload: { requestId: row.id, kind: row.kind, dueAt: toIsoRequired(row.dueAt) },
  })
  return toRequestDto(row, now)
}
