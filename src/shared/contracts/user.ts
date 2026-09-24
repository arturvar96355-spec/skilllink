import type { UserRole } from './enums'

/** Пользователь системы. Персональные данные — минимум: ФИО, должность, рабочая почта. */
export interface UserDto {
  id: string
  /**
   * Рабочая почта — только для ADMIN и MANAGER: им она нужна, чтобы связаться
   * с ответственным. Аналитику и наблюдателю приходит null.
   */
  email: string | null
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
  /** Должность — шапка и личный кабинет показывают её под именем. */
  position: string | null
  role: UserRole
  universityId: string | null
  /** Название вуза представителя: чтобы шапка не делала ради него отдельный запрос. */
  universityName: string | null
  /** Права текущей роли — чтобы фронт не дублировал матрицу доступа. */
  permissions: {
    canWrite: boolean
    canSeeAnalytics: boolean
    canUsePortal: boolean
    /** Подтверждать материалы, вносить показатели и подавать заявки в кабинете вуза. */
    canWritePortal: boolean
    isAdmin: boolean
  }
}

/**
 * Личная статистика — `GET /api/me/stats`, блок «Статистика» личного кабинета.
 *
 * Всё считается по связкам и этапам, где пользователь — ответственный, и теми же
 * правилами, что соответствующие показатели дашборда: «активная связка»,
 * «этап закрыт в срок», «этап просрочен» значат здесь то же самое.
 */
export interface CurrentUserStatsDto {
  /** Связки в работе (черновик или активна), где пользователь — ответственный. */
  activeCooperations: number
  /** Разных вузов среди этих связок. */
  universitiesInWork: number
  /** Разных программ среди этих связок. */
  programsManaged: number
  /** Доля своих этапов, закрытых не позже срока. null — «Нет данных», а не ноль. */
  stagesOnTimePercent: number | null
  /** Из скольких завершённых этапов со сроком посчитана доля. */
  stagesCompletedWithDeadline: number
  /** Свои этапы с истёкшим сроком в незакрытых связках. */
  overdueStages: number
  /** Есть ли среди связок демонстрационные — фронт обязан это показать. */
  containsMockData: boolean
  generatedAt: string
}
