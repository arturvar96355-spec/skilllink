import { forbidden, notFound } from '@/shared/http/errors'
import { can } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'

/**
 * Номер этапа, задачи которого вуз подтверждает сам:
 * «Передача учебных материалов, лицензии и документации» (решение 9).
 */
export const MATERIALS_STAGE_NUMBER = 7

/**
 * Идентификатор вуза текущего пользователя.
 *
 * Сотрудник ИТ-Школы может работать с кабинетом любого вуза, но обязан указать, какого.
 * Представитель вуза работает только со своим и параметр игнорирует.
 */
export function resolvePortalUniversityId(
  user: CurrentUser,
  requested: string | undefined,
): string {
  if (user.role === 'UNIVERSITY_REP') {
    if (!user.universityId) {
      throw forbidden('Учётной записи представителя вуза не назначен вуз. Обратитесь к администратору.')
    }
    return user.universityId
  }

  if (!requested) {
    throw notFound('Укажите вуз: параметр universityId обязателен для сотрудников ИТ-Школы')
  }
  return requested
}

/** Подтверждать можно только задачи этапа передачи материалов. */
export function assertMaterialsTask(stageNumber: number): void {
  if (stageNumber !== MATERIALS_STAGE_NUMBER) {
    throw notFound('Задача не относится к передаче материалов')
  }
}

/**
 * Записывать в кабинете вуза может только сам вуз (UNIVERSITY_PORTAL_WRITE).
 *
 * Сотрудник ИТ-Школы кабинет любого вуза открывает, но только смотрит. Раньше он
 * мог подтвердить получение материалов, внести показатели и подать заявку от имени
 * вуза — и в системе выглядело бы, что это сделал вуз.
 */
export function assertPortalWritable(user: CurrentUser): void {
  if (!can(user, 'UNIVERSITY_PORTAL_WRITE')) {
    throw forbidden('В кабинете вуза сотрудник только просматривает; подтверждает сам вуз')
  }
}
