import { pageMeta } from '@/shared/http/pagination'
import { can, assertCan } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { PageMeta } from '@/shared/contracts/common'
import type { CurrentUserDto, UserDto } from '@/shared/contracts/user'
import * as repo from './auth.repo'
import type { UserListQuery } from './auth.schema'

/**
 * Справочник пользователей: нужен для выбора ответственного и участников встреч.
 * Представителю вуза он недоступен — состав сотрудников ИТ-Школы его не касается.
 */
export async function listUsers(
  user: CurrentUser,
  query: UserListQuery,
): Promise<{ data: UserDto[]; meta: PageMeta }> {
  assertCan(user, 'ANALYTICS')

  const { rows, total } = await repo.findMany(query)
  return {
    data: rows.map((row) => ({
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      position: row.position,
      role: row.role,
      universityId: row.universityId,
      universityName: row.university?.name ?? null,
      isActive: row.isActive,
    })),
    meta: pageMeta({ page: query.page, pageSize: query.pageSize }, total),
  }
}

/** Текущий пользователь и его права: фронт по ним решает, что показывать. */
/**
 * Должность и вуз не входят в объект текущего пользователя: он проходит через
 * каждую проверку прав, и тащить туда поля для шапки незачем. Их дочитывает
 * `currentUserProfile` — один запрос на открытие страницы.
 */
export interface CurrentUserProfile {
  position: string | null
  universityName: string | null
}

export function describeCurrentUser(
  user: CurrentUser,
  profile: CurrentUserProfile = { position: null, universityName: null },
): CurrentUserDto {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    position: profile.position,
    role: user.role,
    universityId: user.universityId,
    universityName: profile.universityName,
    permissions: {
      canWrite: can(user, 'WRITE'),
      canSeeAnalytics: can(user, 'ANALYTICS'),
      canUsePortal: can(user, 'UNIVERSITY_PORTAL'),
      isAdmin: can(user, 'ADMIN'),
    },
  }
}

/** Текущий пользователь с профилем — ответ `GET /api/me`. */
export async function currentUserProfile(user: CurrentUser): Promise<CurrentUserDto> {
  const profile = await repo.findProfile(user.id)
  return describeCurrentUser(user, {
    position: profile?.position ?? null,
    universityName: profile?.university?.name ?? null,
  })
}
