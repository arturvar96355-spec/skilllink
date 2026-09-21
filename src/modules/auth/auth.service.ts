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
export function describeCurrentUser(user: CurrentUser): CurrentUserDto {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    universityId: user.universityId,
    permissions: {
      canWrite: can(user, 'WRITE'),
      canSeeAnalytics: can(user, 'ANALYTICS'),
      canUsePortal: can(user, 'UNIVERSITY_PORTAL'),
      isAdmin: can(user, 'ADMIN'),
    },
  }
}
