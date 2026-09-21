import type { UserRole } from './enums'

/** Пользователь системы. Персональные данные — минимум: ФИО, должность, рабочая почта. */
export interface UserDto {
  id: string
  email: string
  fullName: string
  position: string | null
  role: UserRole
  /** Заполнен только у UNIVERSITY_REP. */
  universityId: string | null
  universityName: string | null
  isActive: boolean
}

/** Текущий пользователь: фронт по нему решает, какие разделы показывать. */
export interface CurrentUserDto {
  id: string
  email: string
  fullName: string
  role: UserRole
  universityId: string | null
  /** Права текущей роли — чтобы фронт не дублировал матрицу доступа. */
  permissions: {
    canWrite: boolean
    canSeeAnalytics: boolean
    canUsePortal: boolean
    isAdmin: boolean
  }
}
