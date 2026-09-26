import { prisma } from '@/shared/db/prisma'
import { writeAudit } from '@/shared/audit/audit'
import { conflict, forbidden, notFound } from '@/shared/http/errors'
import { pageMeta, type Pagination } from '@/shared/http/pagination'
import { assertCan, can, canSeeContactDetails as canSeeContactDetailsByRole, universityScope } from '@/shared/auth/permissions'
import { contactRevealRequired } from '@/shared/config/contacts.config'
import { redactString } from '@/shared/log/redact'
import { maskEmailForDisplay, maskPhoneForDisplay } from '@/shared/utils/mask'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { PageMeta } from '@/shared/contracts/common'
import type {
  ContactBasisHistoryEntryDto,
  ContactDto,
  ContactRevealDto,
  ContactLegalBasisDto,
  UniversityDto,
  UniversityListItemDto,
} from '@/shared/contracts/university'
import type { ConsentForm, ConsentStatus, ContactLegalBasis } from '@/shared/contracts/enums'
import type { UniversityRatingDto } from '@/shared/contracts/rating'
import * as analyticsService from '@/modules/analytics/analytics.service'
import { toIso, toIsoRequired } from '@/shared/utils/date'
import * as repo from './universities.repo'
import {
  ANONYMIZED_CONTACT_FIELDS,
  assertCanArchive,
  assertNotArchived,
  basisHistoryKind,
  isAnonymizedContact,
  planBasisChange,
  planConsentWithdrawal,
} from './universities.rules'
import {
  needsRating,
  ratingRequestedExplicitly,
  UNIVERSITY_RATING_SORT,
  type CreateUniversityInput,
  type SetContactBasisBody,
  type UniversityListQuery,
  type UpdateUniversityInput,
  type WithdrawConsentBody,
} from './universities.schema'

/**
 * Почта и телефон прямо в карточке (решение 106) — если роль вправе их видеть
 * и не включён строгий режим раскрытия (CONTACT_REVEAL_REQUIRED, решение 123):
 * тогда в карточке только маски, а значения — через раскрытие с журналом.
 */
function canSeeContactDetails(user: CurrentUser, universityId?: string): boolean {
  return canSeeContactDetailsByRole(user, universityId) && !contactRevealRequired()
}

/** Поля учёта основания обработки ПД в строке контакта (решение 111). */
export interface ContactBasisColumns {
  legalBasis: ContactLegalBasis | null
  consentStatus: ConsentStatus
  consentObtainedAt: Date | null
  consentForm: ConsentForm | null
  consentWithdrawnAt: Date | null
  basisReference: string | null
  withdrawalReference: string | null
  basisUpdatedAt: Date | null
  consentPolicyVersion: string | null
  consentTextHash: string | null
  consentContext: string | null
}

function toLegalBasisDto(row: ContactBasisColumns): ContactLegalBasisDto | null {
  if (row.legalBasis === null || row.basisUpdatedAt === null) return null
  return {
    basis: row.legalBasis,
    consentStatus: row.consentStatus,
    consentObtainedAt: toIso(row.consentObtainedAt),
    consentForm: row.consentForm,
    consentWithdrawnAt: toIso(row.consentWithdrawnAt),
    documentReference: row.basisReference ?? '',
    withdrawalReference: row.withdrawalReference,
    updatedAt: toIsoRequired(row.basisUpdatedAt),
    policyVersion: row.consentPolicyVersion,
    consentTextHash: row.consentTextHash,
    consentContext: row.consentContext,
  }
}

/**
 * Контакт наружу. `showDetails` — вправе ли роль видеть почту и телефон
 * (canSeeContactDetails, решение 106). Без права они заменяются на null здесь,
 * в сервисе, а не во фронте: в ответ API значения не попадают вовсе.
 *
 * `showBasis` — вправе ли роль видеть основание обработки и согласие (право
 * CONTACT_BASIS, решение 111). Без права — только признак `basisRecorded`.
 */
export function toContactDto(
  row: {
    id: string
    fullName: string
    position: string | null
    email: string | null
    phone: string | null
    isPrimary: boolean
  } & ContactBasisColumns,
  showDetails: boolean,
  showBasis: boolean,
): ContactDto {
  // Признак обезличивания — по исходной строке: у скрытого контакта почта тоже null,
  // но он не обезличен.
  const isAnonymized = isAnonymizedContact(row)
  return {
    id: row.id,
    fullName: row.fullName,
    position: row.position,
    email: showDetails ? row.email : null,
    phone: showDetails ? row.phone : null,
    isPrimary: row.isPrimary,
    isAnonymized,
    // У обезличенного скрывать нечего — там «нет данных», а не «скрыто».
    contactDetailsHidden: !showDetails && !isAnonymized,
    // Маски — всем, кто видит контакт (решение 123): вместо «скрыто» видно, что есть.
    emailMasked: isAnonymized ? null : maskEmailForDisplay(row.email),
    phoneMasked: isAnonymized ? null : maskPhoneForDisplay(row.phone),
    basisRecorded: row.legalBasis !== null,
    legalBasis: showBasis ? toLegalBasisDto(row) : null,
  }
}

/**
 * Вуз без действующих программ в карту рейтингов не попадает: считать там нечего.
 * Но строка реестра должна объяснять пустоту, а не отдавать голый null.
 */
function ratingFor(
  universityId: string,
  ratings: ReadonlyMap<string, UniversityRatingDto> | null,
): UniversityRatingDto | null {
  if (!ratings) return null
  return (
    ratings.get(universityId) ?? {
      universityId,
      score: null,
      basis: 'none',
      explanation: 'Нет данных: у вуза нет действующих программ',
      programCount: 0,
      ratedProgramCount: 0,
      topProgram: null,
    }
  )
}

function toListItem(
  row: repo.UniversityListRow,
  activeCooperations: number,
  rating: UniversityRatingDto | null = null,
): UniversityListItemDto {
  return {
    id: row.id,
    name: row.name,
    shortName: row.shortName,
    city: row.city,
    region: row.region,
    status: row.status,
    programCount: row._count.programs,
    cooperationCount: row._count.cooperations,
    activeCooperationCount: activeCooperations,
    isMock: row.isMock,
    rating,
    updatedAt: toIsoRequired(row.updatedAt),
    archivedAt: toIso(row.archivedAt),
  }
}

export function toDetail(
  user: CurrentUser,
  row: repo.UniversityDetailRow,
  activeCooperations: number,
  rating: UniversityRatingDto | null = null,
): UniversityDto {
  const showDetails = canSeeContactDetails(user, row.id)
  const showBasis = can(user, 'CONTACT_BASIS')
  const contacts = row.contacts.map((contact) => toContactDto(contact, showDetails, showBasis))
  return {
    ...toListItem(row, activeCooperations, rating),
    address: row.address,
    website: row.website,
    description: row.description,
    directionCount: row.directionCount,
    studentCount: row.studentCount,
    // Обезличенный контакт основным не бывает — и запасным «первым попавшимся» тоже.
    primaryContact:
      contacts.find((contact) => contact.isPrimary) ??
      contacts.find((contact) => !contact.isAnonymized) ??
      null,
    contacts,
    createdAt: toIsoRequired(row.createdAt),
  }
}

export async function list(
  user: CurrentUser,
  query: UniversityListQuery,
): Promise<{ data: UniversityListItemDto[]; meta: PageMeta }> {
  assertCan(user, 'READ')

  // Рейтинг — аналитика. Представителю вуза он недоступен даже как фильтр: по отклику
  // списка можно было бы восстановить баллы чужих вузов.
  //
  // Но реестр он открывать вправе, а рейтинг возвращается по умолчанию —
  // поэтому отказом отвечаем только на явный запрос. Умолчание для этой роли
  // просто не считается, и в ответе приходит null.
  if (ratingRequestedExplicitly(query)) assertCan(user, 'ANALYTICS')

  const wantsRating = needsRating(query) && can(user, 'ANALYTICS')

  // Полный расчёт нужен только там, где по рейтингу отбирают или сортируют:
  // чтобы сравнить вузы по баллу, балл нужен у каждого. Для обычного показа
  // хватает программ одной страницы — на тысяче вузов это вдвое быстрее.
  const needsEveryRating =
    query.minRating !== undefined ||
    query.maxRating !== undefined ||
    query.sort?.replace(/^-/, '') === UNIVERSITY_RATING_SORT

  const ratings = wantsRating && needsEveryRating
    ? await analyticsService.universityRatings(user)
    : null

  const restrictToIds =
    ratings && (query.minRating !== undefined || query.maxRating !== undefined)
      ? [...ratings.values()]
          .filter(
            (rating) =>
              rating.score !== null &&
              (query.minRating === undefined || rating.score >= query.minRating) &&
              (query.maxRating === undefined || rating.score <= query.maxRating),
          )
          .map((rating) => rating.universityId)
      : undefined

  const pagination = { page: query.page, pageSize: query.pageSize }
  const sortsByRating = ratings !== null && query.sort?.replace(/^-/, '') === UNIVERSITY_RATING_SORT

  if (sortsByRating) {
    // Рейтинга в базе нет, поэтому порядок и страница считаются здесь.
    // Вузы без балла уходят в конец при любом направлении: «Нет данных» — это
    // не ноль и не максимум, оно просто не участвует в ранжировании.
    const descending = query.sort?.startsWith('-') ?? false
    const matchedIds = await repo.findIds(query, universityScope(user), restrictToIds)

    const ordered = matchedIds.slice().sort((left, right) => {
      const leftScore = ratingFor(left, ratings)?.score ?? null
      const rightScore = ratingFor(right, ratings)?.score ?? null
      if (leftScore === null && rightScore === null) return 0
      if (leftScore === null) return 1
      if (rightScore === null) return -1
      return descending ? rightScore - leftScore : leftScore - rightScore
    })

    const skip = (pagination.page - 1) * pagination.pageSize
    const pageIds = ordered.slice(skip, skip + pagination.pageSize)
    const rows = await repo.findByIds(pageIds)
    const byId = new Map(rows.map((row) => [row.id, row]))
    const activeByUniversity = await repo.countActiveCooperations(pageIds)

    return {
      data: pageIds.flatMap((id) => {
        const row = byId.get(id)
        return row
          ? [toListItem(row, activeByUniversity.get(id) ?? 0, ratingFor(id, ratings))]
          : []
      }),
      meta: pageMeta(pagination, ordered.length),
    }
  }

  const { rows, total } = await repo.findMany(query, universityScope(user), restrictToIds)
  const pageIds = rows.map((row) => row.id)

  const [activeByUniversity, pageRatings] = await Promise.all([
    repo.countActiveCooperations(pageIds),
    ratings
      ? Promise.resolve(ratings)
      : wantsRating
        ? analyticsService.universityRatingsForPage(user, pageIds)
        : Promise.resolve(null),
  ])

  return {
    data: rows.map((row) =>
      toListItem(row, activeByUniversity.get(row.id) ?? 0, ratingFor(row.id, pageRatings)),
    ),
    meta: pageMeta(pagination, total),
  }
}

export async function getById(user: CurrentUser, id: string): Promise<UniversityDto> {
  assertCan(user, 'READ')
  const row = await repo.findById(id, universityScope(user))
  // Чужой вуз для представителя — NOT_FOUND, существование записи не раскрывается.
  if (!row) throw notFound('Вуз не найден')
  const activeByUniversity = await repo.countActiveCooperations([row.id])

  // Карточка — единственное место, где рейтинг нужно раскрыть: с сильнейшей программой
  // и пояснением, по скольким программам он посчитан. Поэтому здесь он считается всегда,
  // в отличие от реестра, где включается параметром. Представителю вуза — null.
  const ratings = can(user, 'ANALYTICS')
    ? await analyticsService.universityRatingsForPage(user, [row.id])
    : null

  return toDetail(user, row, activeByUniversity.get(row.id) ?? 0, ratingFor(row.id, ratings))
}

export async function create(
  user: CurrentUser,
  input: CreateUniversityInput,
): Promise<UniversityDto> {
  assertCan(user, 'WRITE')
  const { contacts, ...fields } = input
  const row = await repo.create({
    ...fields,
    ...(contacts?.length ? { contacts: { create: contacts } } : {}),
  })
  // Журнал обещан в SECURITY_LIMITATIONS («создание и изменение вуза»). Только имена
  // полей: значения — в самой записи, а в контактах есть персональные данные,
  // которым в журнале не место.
  await writeAudit({
    userId: user.id,
    action: 'university.create',
    objectType: 'University',
    objectId: row.id,
    payload: { fields: Object.keys(fields), contacts: contacts?.length ?? 0 },
  })
  return toDetail(user, row, 0)
}

export async function update(
  user: CurrentUser,
  id: string,
  input: UpdateUniversityInput,
): Promise<UniversityDto> {
  assertCan(user, 'WRITE')
  const existing = await repo.findById(id, universityScope(user))
  if (!existing) throw notFound('Вуз не найден')
  assertNotArchived(existing.archivedAt)

  const row = await repo.update(id, input)
  await writeAudit({
    userId: user.id,
    action: 'university.update',
    objectType: 'University',
    objectId: id,
    payload: { fields: Object.keys(input) },
  })
  const activeByUniversity = await repo.countActiveCooperations([row.id])

  // Карточка — единственное место, где рейтинг нужно раскрыть: с сильнейшей программой
  // и пояснением, по скольким программам он посчитан. Поэтому здесь он считается всегда,
  // в отличие от реестра, где включается параметром. Представителю вуза — null.
  const ratings = can(user, 'ANALYTICS')
    ? await analyticsService.universityRatingsForPage(user, [row.id])
    : null

  return toDetail(user, row, activeByUniversity.get(row.id) ?? 0, ratingFor(row.id, ratings))
}

/** Архивирование вместо удаления: история сотрудничества должна сохраняться. */
export async function archive(user: CurrentUser, id: string): Promise<UniversityDto> {
  assertCan(user, 'WRITE')
  const existing = await repo.findById(id, universityScope(user))
  if (!existing) throw notFound('Вуз не найден')
  if (existing.archivedAt) return toDetail(user, existing, 0)

  const openCooperations = await prisma.cooperation.count({
    where: { universityId: id, status: { in: ['DRAFT', 'ACTIVE', 'PAUSED'] } },
  })
  assertCanArchive(openCooperations)

  const row = await repo.update(id, { archivedAt: new Date(), status: 'ARCHIVED' })
  await writeAudit({
    userId: user.id,
    action: 'university.archive',
    objectType: 'University',
    objectId: id,
  })
  return toDetail(user, row, 0)
}

export async function restore(user: CurrentUser, id: string): Promise<UniversityDto> {
  assertCan(user, 'WRITE')
  const existing = await repo.findById(id, universityScope(user))
  if (!existing) throw notFound('Вуз не найден')
  const row = await repo.update(id, { archivedAt: null, status: 'IN_PROGRESS' })
  await writeAudit({
    userId: user.id,
    action: 'university.restore',
    objectType: 'University',
    objectId: id,
  })
  const activeByUniversity = await repo.countActiveCooperations([row.id])

  // Карточка — единственное место, где рейтинг нужно раскрыть: с сильнейшей программой
  // и пояснением, по скольким программам он посчитан. Поэтому здесь он считается всегда,
  // в отличие от реестра, где включается параметром. Представителю вуза — null.
  const ratings = can(user, 'ANALYTICS')
    ? await analyticsService.universityRatingsForPage(user, [row.id])
    : null

  return toDetail(user, row, activeByUniversity.get(row.id) ?? 0, ratingFor(row.id, ratings))
}

/**
 * Обезличить контактное лицо вуза — право субъекта на удаление персональных данных
 * (docs/PRIVACY.md, раздел «Права субъектов»). Только администратор: это необратимо.
 *
 * Запись остаётся ради связей (участники встреч) и истории; ФИО, должность, почта,
 * телефон и заметки стираются, признак основного снимается. Архив вуза не мешает:
 * право на удаление не кончается вместе с сотрудничеством.
 *
 * В журнал идёт факт и вуз — без ФИО и прежних значений: иначе журнал стал бы
 * копией того, что просили удалить.
 */
export async function anonymizeContact(
  user: CurrentUser,
  universityId: string,
  contactId: string,
): Promise<ContactDto> {
  assertCan(user, 'ADMIN')
  const existing = await repo.findContact(universityId, contactId)
  if (!existing) throw notFound('Контакт не найден')
  // Повтор — не ошибка и не новая запись в журнале: результат тот же.
  if (isAnonymizedContact(existing)) {
    return toContactDto(existing, canSeeContactDetails(user, universityId), can(user, 'CONTACT_BASIS'))
  }

  const row = await repo.updateContact(contactId, { ...ANONYMIZED_CONTACT_FIELDS })
  await writeAudit({
    userId: user.id,
    action: 'contact.anonymize',
    objectType: 'Contact',
    objectId: contactId,
    payload: { universityId, wasPrimary: existing.isPrimary },
  })
  return toContactDto(row, canSeeContactDetails(user, universityId), can(user, 'CONTACT_BASIS'))
}

/**
 * Зафиксировать правовое основание обработки ПД контакта (решение 111):
 * законный интерес по договору с вузом, договор с самим контактом, согласие
 * (с датой и формой) или иное — с документом-основанием. ADMIN и MANAGER.
 *
 * Повтор той же формы ничего не меняет и журнал не засоряет. В журнал — коды
 * «было → стало» и признак смены документа; текст документа — только в карточке.
 */
export async function setContactBasis(
  user: CurrentUser,
  universityId: string,
  contactId: string,
  input: SetContactBasisBody,
  now: Date = new Date(),
): Promise<ContactDto> {
  assertCan(user, 'CONTACT_BASIS')
  const result = await repo.changeContactBasis(universityId, contactId, user.id, (current) =>
    planBasisChange(current, input, now),
  )
  if (!result) throw notFound('Контакт не найден')

  if (result.changed) {
    await writeAudit({
      userId: user.id,
      action: 'contact.basis.set',
      objectType: 'Contact',
      objectId: contactId,
      payload: {
        universityId,
        fromBasis: result.before.legalBasis,
        toBasis: result.after.legalBasis,
        fromConsentStatus: result.before.consentStatus,
        toConsentStatus: result.after.consentStatus,
        referenceChanged: result.before.basisReference !== result.after.basisReference,
      },
    })
  }
  return toContactDto(result.after, canSeeContactDetails(user, universityId), true)
}

/**
 * Отозвать согласие контакта (ст. 9, ч. 5 ст. 21 152-ФЗ). ADMIN и MANAGER.
 *
 * Согласие было единственным основанием — контакт обезличивается сразу, в той же
 * транзакции и тем же набором полей, что и по запросу субъекта (anonymizeContact).
 * В журнал — два действия: отзыв и обезличивание, чтобы выгрузка для акта
 * уничтожения по `contact.anonymize` оставалась полной. Повтор — тот же результат
 * без новых записей.
 */
export async function withdrawContactConsent(
  user: CurrentUser,
  universityId: string,
  contactId: string,
  input: WithdrawConsentBody,
  now: Date = new Date(),
): Promise<ContactDto> {
  assertCan(user, 'CONTACT_BASIS')
  const result = await repo.changeContactBasis(universityId, contactId, user.id, (current) =>
    planConsentWithdrawal(current, input, now),
  )
  if (!result) throw notFound('Контакт не найден')

  if (result.changed) {
    const anonymized = !isAnonymizedContact(result.before) && isAnonymizedContact(result.after)
    await writeAudit({
      userId: user.id,
      action: 'contact.consent.withdraw',
      objectType: 'Contact',
      objectId: contactId,
      payload: { universityId, anonymized },
    })
    if (anonymized) {
      await writeAudit({
        userId: user.id,
        action: 'contact.anonymize',
        objectType: 'Contact',
        objectId: contactId,
        payload: { universityId, wasPrimary: result.before.isPrimary, reason: 'consent.withdraw' },
      })
    }
  }
  return toContactDto(result.after, canSeeContactDetails(user, universityId), true)
}

function toBasisHistoryEntry(row: repo.ContactBasisHistoryRow): ContactBasisHistoryEntryDto {
  return {
    id: row.id,
    kind: basisHistoryKind(row),
    fromBasis: row.fromBasis,
    toBasis: row.toBasis,
    fromConsentStatus: row.fromConsentStatus,
    toConsentStatus: row.toConsentStatus,
    consentObtainedAt: toIso(row.consentObtainedAt),
    consentForm: row.consentForm,
    consentWithdrawnAt: toIso(row.consentWithdrawnAt),
    referenceChanged: row.referenceChanged,
    anonymized: row.anonymized,
    policyVersion: row.policyVersion,
    consentTextHash: row.consentTextHash,
    changedBy: row.changedBy,
    changedAt: toIsoRequired(row.changedAt),
  }
}

/** История основания и согласия контакта (решение 111). ADMIN и MANAGER. */
export async function contactBasisHistory(
  user: CurrentUser,
  universityId: string,
  contactId: string,
  pagination: Pagination,
): Promise<{ data: ContactBasisHistoryEntryDto[]; meta: PageMeta }> {
  assertCan(user, 'CONTACT_BASIS')
  const contact = await repo.findContact(universityId, contactId)
  if (!contact) throw notFound('Контакт не найден')
  const { rows, total } = await repo.findBasisHistory(contactId, pagination)
  return { data: rows.map(toBasisHistoryEntry), meta: pageMeta(pagination, total) }
}

// ─────────────── Раскрытие почты и телефона с журналом (решение 123) ───────────────

/**
 * Раскрыть почту и/или телефон контакта с обязательной причиной. Каждое раскрытие —
 * запись `contact.revealed` в журнале: какие поля, чей контакт, зачем.
 *
 * Кто может — те же, кто видит контакты по решению 106: ADMIN и MANAGER, представитель
 * вуза — своего. Аналитику и наблюдателю — 403 до поиска контакта: раскрытие «по
 * служебной необходимости» для них означало бы отменить решение владельца 106
 * одной строкой причины. Контакт чужого вуза для представителя — 404.
 *
 * Причина идёт в журнал с маскированными почтой и телефонами: в ней пишут
 * «уточнить у ivanov@…», и журнал не должен стать копией раскрытого.
 */
export async function revealContact(
  user: CurrentUser,
  contactId: string,
  input: { fields?: Array<'email' | 'phone'> | undefined; reason: string },
  now: Date = new Date(),
): Promise<ContactRevealDto> {
  assertCan(user, 'READ')
  if (!can(user, 'CONTACT_DETAILS') && user.role !== 'UNIVERSITY_REP') {
    throw forbidden('Почту и телефон контактов видят менеджер и администратор')
  }
  const row = await repo.findContactById(contactId)
  if (!row || !canSeeContactDetailsByRole(user, row.universityId)) throw notFound('Контакт не найден')
  if (isAnonymizedContact(row)) throw conflict('Контакт обезличен: раскрывать нечего')

  const requested = new Set(input.fields && input.fields.length > 0 ? input.fields : (['email', 'phone'] as const))
  const email = requested.has('email') ? row.email : null
  const phone = requested.has('phone') ? row.phone : null
  const revealedFields = [...(email ? (['email'] as const) : []), ...(phone ? (['phone'] as const) : [])]

  await writeAudit({
    userId: user.id,
    action: 'contact.revealed',
    objectType: 'Contact',
    objectId: row.id,
    payload: {
      universityId: row.universityId,
      fields: revealedFields,
      requested: [...requested],
      reason: redactString(input.reason),
    },
  })

  return { id: row.id, universityId: row.universityId, email, phone, revealedFields, revealedAt: now.toISOString() }
}
