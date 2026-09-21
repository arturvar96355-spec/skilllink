import type { UniversityStatus } from './enums'

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
