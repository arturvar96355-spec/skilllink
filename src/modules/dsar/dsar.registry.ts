import type { Prisma } from '@/generated/prisma/client'
import { ANONYMIZED_CONTACT_FIELDS } from '@/modules/universities/universities.rules'
import { ERASED_USER_NAME, erasedUserEmail } from './dsar.rules'

/**
 * Реестр «всё о субъекте» (решение 116): где в базе лежат сведения о человеке
 * и что с ними делать при выгрузке и при обезличивании.
 *
 * Реестр — единственный источник и для выгрузки (`GET …/export`), и для
 * обезличивания (`POST …/erase`): раздел, которого здесь нет, не выгружается
 * и не обезличивается. Поэтому полноту реестра сторожит тест
 * `dsar.registry.test.ts`: он читает схему Prisma и падает, если у модели есть
 * ссылка на пользователя или контакт (или поле с ПД), а в реестре её нет.
 *
 * Каскады `ON DELETE` при обезличивании не срабатывают — строку никто не удаляет.
 * Поэтому каждая зависимая таблица с ПД перечислена здесь явно со своим действием.
 */

export type DsarSubjectKind = 'USER' | 'CONTACT'

/**
 * Что делает обезличивание с разделом:
 * - `redact` — поля с ПД заменяются заглушкой, строка остаётся (ссылки на неё целы);
 * - `delete` — строка удаляется (то, что без субъекта не имеет смысла: доступ без сессии);
 * - `keep` — остаётся как есть, причина обязательна (ссылка на заглушку, обязанность оператора).
 */
export type DsarEraseAction = 'redact' | 'delete' | 'keep'

/** Субъект, по которому строится выборка раздела. */
export interface DsarSubjectRef {
  kind: DsarSubjectKind
  id: string
  /** ФИО для поиска упоминаний в текстах; null — субъект уже обезличен, искать нечего. */
  name: string | null
}

export interface DsarEntry {
  /** Ключ раздела в `data` выгрузки. */
  section: string
  /** Модель Prisma. */
  model: Prisma.ModelName
  /** Человеческое название раздела — в выгрузке. */
  title: string
  /**
   * Поля модели, через которые запись связана с субъектом: внешние ключи, `id`
   * профиля, текст, в котором он упомянут. По ним тест полноты сверяет реестр со схемой.
   */
  links: readonly string[]
  /**
   * Условие выборки. По умолчанию — любая из `links` равна идентификатору субъекта.
   * null — раздел для этого субъекта пуст по построению (обезличенному нечего искать в текстах).
   */
  where?: (subject: DsarSubjectRef) => Record<string, unknown> | null
  /** Что попадает в выгрузку. Секретов (хешей, токенов, паролей) здесь нет — это проверяет тест. */
  select: Record<string, unknown>
  /**
   * Поля с ПД, которые сознательно не выгружаются, и почему. Тест требует, чтобы
   * каждое поле с ПД модели было либо в `select`, либо здесь.
   */
  omitted?: Readonly<Record<string, string>>
  orderBy: Record<string, 'asc' | 'desc'>
  /** Последний ключ сортировки — уникальный; по умолчанию `id` (у модели без `id` — свой). */
  tieBreaker?: Record<string, 'asc'>
  /** Записи журнала: в выгрузке идут не в `data`, а в `auditTrail`. */
  trail?: 'byActor' | 'aboutSubject'
  erase: DsarEraseAction
  /** Почему действие именно такое. Для `keep` — обязательное обоснование. */
  reason: string
  /** Новые значения полей для `redact`. */
  redact?: (subject: DsarSubjectRef) => Record<string, unknown>
}

/** Ссылка на вуз и программу — названия организаций, это не ПД. */
const COOPERATION_REF = {
  select: {
    id: true,
    university: { select: { name: true, shortName: true } },
    program: { select: { name: true } },
  },
} as const

const FREE_TEXT = 'свободный текст: может содержать ПД третьих лиц, не выгружается (PRIVACY.md, 2.1)'
const KEEP_REFERENCE =
  'рабочая запись оператора (Ц1): ссылка остаётся ради целостности истории и указывает на обезличенную учётную запись'
const KEEP_AUDIT =
  'журнал действий не меняется: обязанность оператора обеспечить безопасность и доказуемость обработки ' +
  '(ст. 19, ч. 3 ст. 9 152-ФЗ; п. 7 ч. 1 ст. 6 — законный интерес); удаляется по сроку хранения (1 год)'
const KEEP_DSAR =
  'реестр запросов субъектов — доказательство исполнения ст. 14 и 20; ПД в нём нет, кроме идентификаторов'

const AUDIT_SELECT = {
  id: true,
  action: true,
  objectType: true,
  objectId: true,
  payload: true,
  createdAt: true,
} as const

const DSAR_REQUEST_SELECT = {
  id: true,
  kind: true,
  channel: true,
  status: true,
  requestedAt: true,
  dueAt: true,
  completedAt: true,
} as const

// ── Пользователь системы ────────────────────────────────────────────────────

const USER_ENTRIES: readonly DsarEntry[] = [
  {
    section: 'profile',
    model: 'User',
    title: 'Учётная запись',
    links: ['id'],
    select: {
      id: true,
      email: true,
      fullName: true,
      position: true,
      role: true,
      isActive: true,
      university: { select: { name: true } },
      createdAt: true,
      updatedAt: true,
    },
    omitted: {
      passwordHash: 'секрет входа: не выгружается никогда, при обезличивании стирается',
      sessionVersion: 'служебный счётчик сессий, не сведения о человеке',
    },
    orderBy: { createdAt: 'asc' },
    erase: 'redact',
    reason:
      'строка остаётся: на неё ссылаются связки, этапы, история и журнал. ФИО, почта и должность — заглушка, ' +
      'пароль стёрт, учётная запись заблокирована, выданные сессии отозваны',
    redact: (subject) => ({
      fullName: ERASED_USER_NAME,
      email: erasedUserEmail(subject.id),
      position: null,
      passwordHash: null,
      isActive: false,
      sessionVersion: { increment: 1 },
    }),
  },
  {
    section: 'telegramLink',
    model: 'TelegramLink',
    title: 'Привязка к Telegram',
    links: ['userId'],
    select: { chatId: true, username: true, linkedAt: true },
    orderBy: { linkedAt: 'asc' },
    erase: 'delete',
    reason: 'доступ к сводкам без сессии и трансграничная передача: без субъекта не нужна (решение 102)',
  },
  {
    section: 'calendarFeed',
    model: 'CalendarFeed',
    title: 'Подписка на календарь',
    links: ['userId'],
    // Только факт и дата: хеш токена — секрет доступа к ленте.
    select: { createdAt: true },
    omitted: { tokenHash: 'хеш ссылки-доступа: секрет, в выгрузке только факт и дата выпуска' },
    orderBy: { createdAt: 'asc' },
    tieBreaker: { userId: 'asc' },
    erase: 'delete',
    reason: 'ссылка — доступ к ленте без входа; у обезличенной учётной записи её быть не должно (решение 105)',
  },
  {
    section: 'cooperationsResponsible',
    model: 'Cooperation',
    title: 'Связки, где ответственный',
    links: ['responsibleId'],
    select: {
      id: true,
      status: true,
      university: { select: { name: true, shortName: true } },
      program: { select: { name: true } },
      createdAt: true,
      closedAt: true,
    },
    omitted: { notes: FREE_TEXT, goal: FREE_TEXT },
    orderBy: { createdAt: 'desc' },
    erase: 'keep',
    reason: KEEP_REFERENCE,
  },
  {
    section: 'stages',
    model: 'WorkflowStage',
    title: 'Этапы: ответственный или завершил',
    links: ['responsibleId', 'completedById'],
    select: {
      id: true,
      stageNumber: true,
      title: true,
      status: true,
      deadline: true,
      completedAt: true,
      responsibleId: true,
      completedById: true,
      cooperation: COOPERATION_REF,
    },
    omitted: { comment: FREE_TEXT, result: FREE_TEXT, blockingReason: FREE_TEXT },
    orderBy: { updatedAt: 'desc' },
    erase: 'keep',
    reason: KEEP_REFERENCE,
  },
  {
    section: 'tasksDone',
    model: 'Task',
    title: 'Отмеченные пункты чек-листов',
    links: ['doneById'],
    select: { id: true, title: true, doneAt: true, stage: { select: { stageNumber: true, cooperationId: true } } },
    omitted: { confirmationNote: FREE_TEXT },
    orderBy: { doneAt: 'desc' },
    erase: 'keep',
    reason: KEEP_REFERENCE,
  },
  {
    section: 'stageHistory',
    model: 'StageHistory',
    title: 'Изменения статусов этапов',
    links: ['changedById'],
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      changedAt: true,
      stage: { select: { stageNumber: true, title: true, cooperationId: true } },
    },
    omitted: { comment: FREE_TEXT },
    orderBy: { changedAt: 'desc' },
    erase: 'keep',
    reason: KEEP_REFERENCE,
  },
  {
    section: 'documents',
    model: 'Document',
    title: 'Документы: автор или ответственный',
    links: ['authorId', 'responsibleId'],
    select: {
      id: true,
      type: true,
      title: true,
      version: true,
      status: true,
      authorId: true,
      responsibleId: true,
      createdAt: true,
    },
    omitted: { content: 'текст договорного документа: хранится по номенклатуре дел, выдаётся копией документа по запросу' },
    orderBy: { createdAt: 'desc' },
    erase: 'keep',
    reason: KEEP_REFERENCE,
  },
  {
    section: 'documentHistory',
    model: 'DocumentHistory',
    title: 'Изменения статусов документов',
    links: ['changedById'],
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      changedAt: true,
      document: { select: { id: true, title: true, version: true } },
    },
    omitted: { comment: FREE_TEXT },
    orderBy: { changedAt: 'desc' },
    erase: 'keep',
    reason: KEEP_REFERENCE,
  },
  {
    section: 'meetingsResponsible',
    model: 'Meeting',
    title: 'Встречи, где ответственный',
    links: ['responsibleId'],
    select: { id: true, date: true, topic: true, format: true, cooperationId: true, university: { select: { name: true } } },
    omitted: { result: FREE_TEXT, nextAction: FREE_TEXT },
    orderBy: { date: 'desc' },
    erase: 'keep',
    reason: KEEP_REFERENCE,
  },
  {
    section: 'meetingParticipations',
    model: 'MeetingParticipant',
    title: 'Участие во встречах',
    links: ['userId'],
    select: {
      id: true,
      createdAt: true,
      meeting: { select: { id: true, date: true, topic: true, format: true, university: { select: { name: true } } } },
    },
    omitted: { externalName: 'участник не из пользователей и не из контактов — не субъект этой выгрузки' },
    orderBy: { createdAt: 'desc' },
    erase: 'keep',
    reason: KEEP_REFERENCE,
  },
  {
    section: 'recommendationsResolved',
    model: 'Recommendation',
    title: 'Рекомендации, закрытые или отклонённые',
    links: ['resolvedById'],
    select: { id: true, type: true, title: true, status: true, resolvedAt: true, cooperationId: true },
    omitted: { resolutionComment: FREE_TEXT },
    orderBy: { resolvedAt: 'desc' },
    erase: 'keep',
    reason: KEEP_REFERENCE,
  },
  {
    section: 'applications',
    model: 'Application',
    title: 'Заявки на обучение, поданные пользователем',
    links: ['createdById'],
    select: {
      id: true,
      quantity: true,
      status: true,
      submittedAt: true,
      program: { select: { name: true } },
      university: { select: { name: true } },
    },
    omitted: { comment: FREE_TEXT },
    orderBy: { submittedAt: 'desc' },
    erase: 'keep',
    reason: KEEP_REFERENCE,
  },
  {
    section: 'contactBasisChanges',
    model: 'ContactBasisHistory',
    title: 'Фиксация оснований обработки ПД контактов (как автор)',
    links: ['changedById'],
    select: { id: true, contactId: true, fromBasis: true, toBasis: true, changedAt: true },
    orderBy: { changedAt: 'desc' },
    erase: 'keep',
    reason: KEEP_REFERENCE,
  },
  {
    section: 'dsarRequestsAbout',
    model: 'DsarRequest',
    title: 'Запросы субъекта ПД о себе',
    links: ['subjectId'],
    where: (subject) => ({ subjectType: 'USER', subjectId: subject.id }),
    select: { ...DSAR_REQUEST_SELECT, ip: true },
    orderBy: { requestedAt: 'desc' },
    erase: 'keep',
    reason: KEEP_DSAR,
  },
  {
    section: 'dsarRequestsRegistered',
    model: 'DsarRequest',
    title: 'Запросы субъектов, зарегистрированные пользователем',
    links: ['requestedById'],
    // О ком чужой запрос — не сведения этого пользователя: только вид и даты.
    where: (subject) => ({ requestedById: subject.id, NOT: { subjectType: 'USER', subjectId: subject.id } }),
    select: { id: true, kind: true, channel: true, requestedAt: true },
    omitted: { ip: 'адрес из чужого запроса — не сведения этого пользователя' },
    orderBy: { requestedAt: 'desc' },
    erase: 'keep',
    reason: KEEP_DSAR,
  },
  {
    section: 'auditByActor',
    model: 'AuditLog',
    title: 'Действия, совершённые пользователем',
    links: ['userId'],
    select: AUDIT_SELECT,
    orderBy: { createdAt: 'desc' },
    trail: 'byActor',
    erase: 'keep',
    reason: KEEP_AUDIT,
  },
  {
    section: 'auditAboutSubject',
    model: 'AuditLog',
    title: 'Действия над учётной записью: кто, когда, что',
    links: ['objectId'],
    where: (subject) => ({ objectType: 'User', objectId: subject.id }),
    select: { ...AUDIT_SELECT, user: { select: { id: true, role: true } } },
    orderBy: { createdAt: 'desc' },
    trail: 'aboutSubject',
    erase: 'keep',
    reason: KEEP_AUDIT,
  },
]

// ── Контактное лицо вуза ────────────────────────────────────────────────────

const CONTACT_ENTRIES: readonly DsarEntry[] = [
  {
    section: 'profile',
    model: 'Contact',
    title: 'Карточка контакта и учёт основания обработки',
    links: ['id'],
    select: {
      id: true,
      fullName: true,
      position: true,
      email: true,
      phone: true,
      isPrimary: true,
      university: { select: { name: true } },
      legalBasis: true,
      consentStatus: true,
      consentObtainedAt: true,
      consentForm: true,
      consentWithdrawnAt: true,
      basisReference: true,
      withdrawalReference: true,
      basisUpdatedAt: true,
      createdAt: true,
      updatedAt: true,
    },
    omitted: { notes: FREE_TEXT + '; при обезличивании стирается' },
    orderBy: { createdAt: 'asc' },
    erase: 'redact',
    reason:
      'тот же набор полей, что у обезличивания в карточке вуза и при отзыве согласия (решения 88, 111): ' +
      'запись остаётся ради встреч и истории, основание и даты согласия — как основание акта',
    redact: () => ({ ...ANONYMIZED_CONTACT_FIELDS }),
  },
  {
    section: 'basisHistory',
    model: 'ContactBasisHistory',
    title: 'История основания обработки и согласия',
    links: ['contactId'],
    select: {
      id: true,
      fromBasis: true,
      toBasis: true,
      fromConsentStatus: true,
      toConsentStatus: true,
      consentObtainedAt: true,
      consentForm: true,
      consentWithdrawnAt: true,
      referenceChanged: true,
      anonymized: true,
      changedAt: true,
    },
    orderBy: { changedAt: 'desc' },
    erase: 'keep',
    reason: 'ПД не содержит; основание акта об уничтожении (решение 111)',
  },
  {
    section: 'meetingParticipations',
    model: 'MeetingParticipant',
    title: 'Участие во встречах',
    links: ['contactId'],
    select: {
      id: true,
      createdAt: true,
      meeting: { select: { id: true, date: true, topic: true, format: true, university: { select: { name: true } } } },
    },
    omitted: { externalName: 'участник не из пользователей и не из контактов — не субъект этой выгрузки' },
    orderBy: { createdAt: 'desc' },
    erase: 'keep',
    reason: 'ссылка на обезличенную запись контакта: встреча остаётся в истории работы с вузом',
  },
  {
    section: 'documentsMentioning',
    model: 'Document',
    title: 'Документы, в тексте которых упомянут контакт',
    links: ['content'],
    // Шаблон подставляет «в лице <ФИО>»: ищем ФИО в тексте. У обезличенного — нечего.
    where: (subject) =>
      subject.name ? { content: { contains: subject.name, mode: 'insensitive' } } : null,
    select: { id: true, type: true, title: true, version: true, status: true, createdAt: true },
    omitted: { content: 'текст договорного документа: выдаётся копией документа по запросу' },
    orderBy: { createdAt: 'desc' },
    erase: 'keep',
    reason:
      'договорный документ: хранится по номенклатуре дел оператора (PRIVACY.md, раздел 5); ' +
      'ФИО в подписанном документе не переписывается',
  },
  {
    section: 'dsarRequestsAbout',
    model: 'DsarRequest',
    title: 'Запросы субъекта ПД о себе',
    links: ['subjectId'],
    where: (subject) => ({ subjectType: 'CONTACT', subjectId: subject.id }),
    select: DSAR_REQUEST_SELECT,
    omitted: { ip: 'у запроса по письму адреса нет; адрес из кабинета — пользователя, не контакта' },
    orderBy: { requestedAt: 'desc' },
    erase: 'keep',
    reason: KEEP_DSAR,
  },
  {
    section: 'auditAboutSubject',
    model: 'AuditLog',
    title: 'Действия над контактом: кто, когда, что',
    links: ['objectId'],
    where: (subject) => ({ objectType: 'Contact', objectId: subject.id }),
    select: { ...AUDIT_SELECT, user: { select: { id: true, role: true } } },
    orderBy: { createdAt: 'desc' },
    trail: 'aboutSubject',
    erase: 'keep',
    reason: KEEP_AUDIT,
  },
]

export const DSAR_REGISTRY: Readonly<Record<DsarSubjectKind, readonly DsarEntry[]>> = {
  USER: USER_ENTRIES,
  CONTACT: CONTACT_ENTRIES,
}

/**
 * Модели без сведений о субъектах — справочники и показатели программ.
 * Тест полноты требует, чтобы каждая модель схемы была либо в реестре, либо здесь
 * с причиной: новая таблица не проскочит незамеченной ни в одну сторону.
 */
export const DSAR_NOT_PERSONAL: Readonly<Partial<Record<Prisma.ModelName, string>>> = {
  University: 'организация, не человек',
  EducationalProgram: 'программа вуза: показатели без ПД обучающихся',
  Skill: 'справочник навыков',
  ProgramSkill: 'связь программы и навыка',
  MarketDemand: 'агрегированный спрос на навык',
  ITProduct: 'справочник продуктов',
  ProductSkill: 'связь продукта и навыка',
  DataSource: 'источник рыночных данных',
  AuditSeal: 'печать журнала: номер и хеш последней записи, число строк — без ссылок на людей (решение 115)',
  AuditChainCut: 'точка чистки журнала по сроку: номер, хеш и дата — без ссылок на людей (решение 115)',
  RecommendationRuleStats: 'счётчики обучения правила (показы, успехи) по общей/вузовской/менеджерской области; ' +
    '`scopeId` — не Prisma-связь, а ключ агрегата без читаемых данных о человеке (решение 119)',
  ForecastModel: 'модель прогноза связок: агрегированные коэффициенты и метрики качества ' +
    '(AUC, Brier, калибровка) по вехе, без ссылок на людей (решение 132)',
}

/** Условие выборки раздела: своё или «любая из ссылок равна идентификатору». */
export function entryWhere(entry: DsarEntry, subject: DsarSubjectRef): Record<string, unknown> | null {
  if (entry.where) return entry.where(subject)
  const conditions = entry.links.map((link) => ({ [link]: subject.id }))
  return conditions.length === 1 ? conditions[0]! : { OR: conditions }
}
