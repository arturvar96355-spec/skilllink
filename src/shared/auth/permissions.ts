import { forbidden } from '@/shared/http/errors'
import type { UserRole } from '@/shared/contracts/enums'
import type { CurrentUser } from './current-user'

/**
 * Разграничение доступа в MVP делается проверками в сервисах (решение 10).
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
   * рыночные данные (решение 98). Раньше аналитик по правам равнялся наблюдателю —
   * роль была пустой. Связки, этапы, документы и справочники он по-прежнему не меняет.
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
 * Почта и телефон контактных лиц вузов в выгрузках — только тем, кто ведёт с ними
 * переписку: ADMIN и MANAGER (право WRITE), как и почта в справочнике пользователей
 * (auth.service.ts). Аналитику и наблюдателю файл с адресами всех контактов не нужен —
 * это персональные данные сверх цели (ст. 5 152-ФЗ, docs/PRIVACY.md).
 */
export function canSeeContactDetails(user: CurrentUser): boolean {
  return can(user, 'WRITE')
}

/**
 * Внутренние заметки сотрудников ИТ-Школы: комментарии к этапам, причины блокировок,
 * заметки по связке, комментарии в истории.
 *
 * Представитель вуза их не видит (решение 9). Сам факт и статус этапа он видит —
 * но не то, что сотрудники пишут друг другу об этом вузе.
 */
export function canSeeInternalNotes(user: CurrentUser): boolean {
  return user.role !== 'UNIVERSITY_REP'
}

/**
 * Представитель вуза видит только свой вуз. Общий хелпер для репозиториев (решение 10).
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
