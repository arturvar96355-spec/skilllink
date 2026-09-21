import type { UniversityStatus } from './enums'
import type { UniversityRatingDto } from './rating'

export interface ContactDto {
  id: string
  fullName: string
  position: string | null
  email: string | null
  phone: string | null
  isPrimary: boolean
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
