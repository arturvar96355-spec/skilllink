import type { ContactLegalBasis, CooperationStatus, ProductStatus, VendorContactChannel } from './enums'
import type { ImportIssueDto } from './enrollment'

/** Вендор в реестре (решение 122). */
export interface VendorListItemDto {
  id: string
  name: string
  products: Array<{ id: string; name: string; status: ProductStatus }>
  contactCount: number
  /** Связки с продуктами вендора. */
  cooperationCount: number
  isMock: boolean
  updatedAt: string
}

/** Контакт вендора. Почта и телефон — только с правом CONTACT_DETAILS (решение 106). */
export interface VendorContactDto {
  id: string
  fullName: string
  email: string | null
  phone: string | null
  preferredChannels: VendorContactChannel[]
  /** По каким продуктам вендора — идентификаторы из `VendorDto.products`. */
  productIds: string[]
  legalBasis: ContactLegalBasis
  /** Почта и телефон скрыты правами, а не отсутствуют. */
  contactDetailsHidden: boolean
}

export interface VendorProductDto {
  id: string
  name: string
  category: string
  version: string | null
  status: ProductStatus
  cooperationCount: number
}

/** Связка «вуз — программа — продукт» с продуктом этого вендора. */
export interface VendorCooperationDto {
  id: string
  status: CooperationStatus
  universityId: string
  universityName: string
  programId: string
  programName: string
  productId: string
  productName: string
}

export interface VendorDto {
  id: string
  name: string
  products: VendorProductDto[]
  contacts: VendorContactDto[]
  cooperations: VendorCooperationDto[]
  /** Курсы ИТ-Школы на базе продуктов вендора. */
  courses: Array<{ id: string; name: string; productId: string | null }>
  isMock: boolean
  createdAt: string
  updatedAt: string
}

/** Предпросмотр и результат загрузки вендоров. */
export interface VendorImportResultDto {
  mode: 'preview' | 'apply'
  format: 'xlsx' | 'csv'
  /** Кодировка CSV; у xlsx — null. */
  encoding: 'utf-8' | 'windows-1251' | null
  /** Лист книги, с которого читали; у CSV — null. */
  sheet: string | null
  totalRows: number
  toCreate: {
    vendors: string[]
    products: string[]
    /** ФИО контактов — это деловые контакты, загрузку видят только ADMIN и MANAGER. */
    contacts: string[]
  }
  toUpdate: {
    products: Array<{ name: string; change: string }>
    contacts: Array<{ fullName: string; vendor: string; fields: string[] }>
  }
  unchanged: { products: number; contacts: number }
  errors: ImportIssueDto[]
  warnings: ImportIssueDto[]
  quality: {
    phonesNormalized: number
    emailsLowercased: number
    /** Ячеек «Продукт» с несколькими продуктами через запятую. */
    multiProductCells: number
    /** Продуктов, найденных в реестре по названию (без учёта кавычек, регистра, пробелов). */
    productsMatched: number
  }
  processedAt: string
}
