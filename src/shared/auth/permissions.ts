import { forbidden } from '@/shared/http/errors'
import type { UserRole } from '@/shared/contracts/enums'
import type { CurrentUser } from './current-user'

/**
 * Разграничение доступа в MVP делается проверками в сервисах, а не политиками СУБД.
 * Политики RLS в PostgreSQL — P2, ограничение честно описано в docs/SECURITY_LIMITATIONS.md.
 */
export const PERMISSIONS = {
  /** Чтение справочников, связей и этапов. */
  READ: ['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER', 'UNIVERSITY_REP'],
  /** Создание и изменение вузов, программ, продуктов, связей, этапов. */
  WRITE: ['ADMIN', 'MANAGER'],
  /** Аналитика, рейтинги, рекомендации. Представителю вуза недоступны. */
  ANALYTICS: ['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER'],
  /**
   * Работа с аналитикой: пересобрать рекомендации, вести их статусы, загрузить
   * рыночные данные (решение 98): без этого аналитик по правам равен наблюдателю.
   * Связки, этапы, документы и справочники он не меняет.
   */
  ANALYTICS_WORK: ['ADMIN', 'MANAGER', 'ANALYST'],
  /** Настройка системы, пользователи, справочники. */
  ADMIN: ['ADMIN'],
  /** Просмотр кабинета вуза. Сотрудник ИТ-Школы открывает кабинет любого вуза. */
  UNIVERSITY_PORTAL: ['ADMIN', 'MANAGER', 'UNIVERSITY_REP'],
  /**
   * Запись в кабинете вуза: подтверждение материалов, заявки, показатели.
   * Только сам вуз — сотрудник, подтвердивший получение материалов «от имени вуза»,
   * подменил бы подтверждение второй стороны своим.
   */
  UNIVERSITY_PORTAL_WRITE: ['UNIVERSITY_REP'],
  /**
   * Личная подписка на календарь сроков и встреч (решение 105). Только сотрудники:
   * в ленте сроки этапов — внутренняя кухня ИТ-Школы, которую представитель вуза
   * не видит (решение 9), а своих сроков и встреч у него в системе нет.
   */
  CALENDAR: ['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER'],
  /**
   * Почта и телефон контактных лиц вузов (решение 106, решение владельца 25.09.2026):
   * только тем, кто ведёт с ними переписку. Аналитик и наблюдатель видят ФИО
   * и должность. Представитель вуза видит контакты своего вуза — это проверяется
   * отдельно в canSeeContactDetails, в список роль не входит.
   */
  CONTACT_DETAILS: ['ADMIN', 'MANAGER'],
  /**
   * Правовое основание обработки ПД контактов и согласия (решение 111): видеть,
   * фиксировать, отзывать согласие, открывать историю. Те же, кто ведёт переписку
   * с контактами и получает от них документы. Представителю вуза — нет даже
   * по своему вузу: это учёт оператора (ИТ-Школы), а не сведения вуза.
   */
  CONTACT_BASIS: ['ADMIN', 'MANAGER'],
  /**
   * Вендоры и курсы ИТ-Школы с показателями набора (решение 122): только сотрудники.
   * Представителю вуза — нет: карточка вендора показывает связки продукта со всеми
   * вузами, а другие вузы ему не видны (решение 9). Состав ролей совпадает с ANALYTICS —
   * фронт определяет доступ по `permissions.canSeeAnalytics`.
   */
  VENDORS: ['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER'],
  /**
   * Загрузка заказов с сайта и файл «Загрузка пользователей» для LMS (решение 122):
   * через эти запросы проходят ФИО, телефоны и почты слушателей. Только те, кто ведёт
   * набор. Совпадает с WRITE — фронт определяет доступ по `permissions.canWrite`.
   * `TODO: PM DECISION` — нужна ли отдельная роль методиста вместо менеджера.
   */
  SITE_ORDERS: ['ADMIN', 'MANAGER'],
} as const satisfies Record<string, readonly UserRole[]>

export type Permission = keyof typeof PERMISSIONS

export function can(user: CurrentUser, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly UserRole[]).includes(user.role)
}

export function assertCan(user: CurrentUser, permission: Permission): void {
  if (!can(user, permission)) {
    throw forbidden('Недостаточно прав для этого действия')
  }
}

/**
 * Почта и телефон контактных лиц вузов — только тем, кто ведёт с ними переписку:
 * ADMIN и MANAGER (право CONTACT_DETAILS, решение 106), как и почта в справочнике
 * пользователей (auth.service.ts). Аналитику и наблюдателю адреса и телефоны
 * не нужны — это персональные данные сверх цели (ст. 5 152-ФЗ, docs/PRIVACY.md).
 *
 * `universityId` — вуз, чьи контакты показываются. Представитель вуза видит
 * контакты своего вуза (как и раньше): это его же коллеги. Без `universityId`
 * (выгрузка по многим вузам) ему — нет.
 */
export function canSeeContactDetails(user: CurrentUser, universityId?: string): boolean {
  if (can(user, 'CONTACT_DETAILS')) return true
  return (
    user.role === 'UNIVERSITY_REP' &&
    universityId !== undefined &&
    user.universityId !== null &&
    user.universityId === universityId
  )
}

/**
 * Внутренние заметки сотрудников ИТ-Школы: комментарии к этапам, причины блокировок,
 * заметки по связке, комментарии в истории.
 *
 * Представитель вуза их не видит: это переписка сотрудников. Сам факт и статус
 * этапа он видит — но не то, что сотрудники пишут друг другу об этом вузе.
 */
export function canSeeInternalNotes(user: CurrentUser): boolean {
  return user.role !== 'UNIVERSITY_REP'
}

/**
 * Представитель вуза видит только свой вуз. Общий хелпер для репозиториев, а не проверка
 * в каждом маршруте.
 *
 * Учётная запись представителя без назначенного вуза — ошибка настройки. Она не должна
 * молча превращаться в доступ ко всем вузам, поэтому такой запрос отклоняется.
 */
export function universityScope(user: CurrentUser): { universityId: string } | Record<string, never> {
  if (user.role !== 'UNIVERSITY_REP') return {}

  if (!user.universityId) {
    throw forbidden('Учётной записи представителя вуза не назначен вуз. Обратитесь к администратору.')
  }
  return { universityId: user.universityId }
}

/**
 * Проверка доступа к записи конкретного вуза.
 * Чужой вуз для представителя — NOT_FOUND, а не FORBIDDEN: существование записи не раскрывается.
 */
export function isUniversityVisible(user: CurrentUser, universityId: string): boolean {
  if (user.role !== 'UNIVERSITY_REP') return true
  return user.universityId === universityId
}
