import type { ConsentForm, ConsentStatus, ContactLegalBasis, UniversityStatus } from './enums'
import type { UniversityRatingDto } from './rating'
import type { UserRefDto } from './workflow'

/**
 * Правовое основание обработки ПД контакта и согласие (решение 111).
 * Отдаётся только ADMIN и MANAGER — тем, кто его фиксирует.
 */
export interface ContactLegalBasisDto {
  basis: ContactLegalBasis
  /** `NONE`, если основание не согласие. */
  consentStatus: ConsentStatus
  /** Дата получения согласия — при `OBTAINED` и `WITHDRAWN`, иначе null. */
  consentObtainedAt: string | null
  consentForm: ConsentForm | null
  /** Дата получения отзыва — только при `WITHDRAWN`. */
  consentWithdrawnAt: string | null
  /** Где лежит документ-основание: номер, дата, место хранения. */
  documentReference: string
  /** Где лежит отзыв согласия — только при `WITHDRAWN`. */
  withdrawalReference: string | null
  /** Когда основание фиксировали в последний раз; кто — в истории. */
  updatedAt: string
  /**
   * Решение 123: редакция политики обработки ПД на момент согласия. Только при
   * согласии; у согласий, записанных до 26.09.2026, — null.
   */
  policyVersion: string | null
  /** Решение 123: SHA-256 (hex) текста подписанного согласия; сам текст не хранится. */
  consentTextHash: string | null
  /** Решение 123: где получено согласие. */
  consentContext: string | null
}

export interface ContactDto {
  id: string
  fullName: string
  position: string | null
  email: string | null
  phone: string | null
  isPrimary: boolean
  /**
   * Контакт обезличен администратором по запросу субъекта (152-ФЗ, docs/PRIVACY.md):
   * вместо ФИО — «Контакт удалён», почты, телефона и должности нет.
   */
  isAnonymized: boolean
  /**
   * Почта и телефон скрыты правами (решение 106): их видят ADMIN и MANAGER,
   * представитель вуза — у своего вуза. Тогда `email` и `phone` — `null` не потому,
   * что их нет, а потому, что роли они недоступны: фронт пишет «скрыто — доступно
   * менеджеру», а не «не указано».
   */
  contactDetailsHidden: boolean
  /**
   * Решение 123: маска почты (`i***@univ.ru`) — всем, кто видит контакт, в том числе
   * при `contactDetailsHidden`: видно, что почта есть и какого она домена. null —
   * почты нет или контакт обезличен. Полное значение — POST /api/contacts/:id/reveal.
   */
  emailMasked: string | null
  /** Решение 123: маска телефона (`+7******71`) — как `emailMasked`. */
  phoneMasked: string | null
  /**
   * Правовое основание обработки ПД зафиксировано (решение 111). Приходит всем,
   * кто видит контакт: это признак, а не сведения о человеке.
   */
  basisRecorded: boolean
  /**
   * Основание и согласие целиком — только ADMIN и MANAGER. Остальным `null`:
   * при `basisRecorded: true` это «скрыто», при `false` — «не зафиксировано».
   */
  legalBasis: ContactLegalBasisDto | null
}

/**
 * Запись истории основания и согласия контакта (решение 111): что было → что стало.
 * Без комментария и без текста документа — только коды, даты и признаки.
 */
export interface ContactBasisHistoryEntryDto {
  id: string
  /** `basis.set` — основание зафиксировано или изменено; `consent.withdraw` — отзыв согласия. */
  kind: 'basis.set' | 'consent.withdraw'
  fromBasis: ContactLegalBasis | null
  toBasis: ContactLegalBasis
  fromConsentStatus: ConsentStatus
  toConsentStatus: ConsentStatus
  consentObtainedAt: string | null
  consentForm: ConsentForm | null
  consentWithdrawnAt: string | null
  /** Документ-основание изменился или появился документ отзыва (сам текст не хранится). */
  referenceChanged: boolean
  /** Изменение повлекло обезличивание контакта. */
  anonymized: boolean
  /** Решение 123: редакция политики и хеш текста согласия на момент записи (null — не согласие или запись до 26.09.2026). */
  policyVersion: string | null
  consentTextHash: string | null
  changedBy: UserRefDto
  changedAt: string
}

/** Строка реестра вузов (раздел 7.2 ТЗ). */
export interface UniversityListItemDto {
  id: string
  name: string
  shortName: string | null
  city: string
  region: string
  status: UniversityStatus
  programCount: number
  cooperationCount: number
  activeCooperationCount: number
  isMock: boolean
  /**
   * Рейтинг вуза (пункт 7.2 ТЗ) — агрегат рейтингов его программ.
   * `null` означает, что рейтинг не запрашивался или роли недоступна аналитика:
   * представитель вуза рейтингов не видит. Отсутствие данных — это `score: null`
   * внутри объекта, а не сам `null`.
   */
  rating: UniversityRatingDto | null
  updatedAt: string
  archivedAt: string | null
}

/** Карточка вуза (раздел 7.3 ТЗ). */
export interface UniversityDto extends UniversityListItemDto {
  address: string | null
  website: string | null
  description: string | null
  directionCount: number | null
  studentCount: number | null
  primaryContact: ContactDto | null
  contacts: ContactDto[]
  createdAt: string
}

/**
 * POST /api/contacts/:id/reveal (решение 133): раскрытые почта и телефон контакта.
 * Каждое раскрытие — запись `contact.revealed` в журнале с перечнем полей и причиной.
 * Не кэшировать и не сохранять на клиенте дольше, чем нужно для показа.
 */
export interface ContactRevealDto {
  id: string
  universityId: string
  /** Запрошено и есть — значение; не запрошено или нет — null. */
  email: string | null
  phone: string | null
  /** Какие поля раскрыты (есть значение и были запрошены). */
  revealedFields: Array<'email' | 'phone'>
  revealedAt: string
}
