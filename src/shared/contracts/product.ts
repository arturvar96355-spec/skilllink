import type { ProductSkillRelevance, ProductStatus } from './enums'

export interface ProductSkillDto {
  skillId: string
  name: string
  category: string
  relevance: ProductSkillRelevance
}

export interface ProductListItemDto {
  id: string
  name: string
  category: string
  version: string | null
  status: ProductStatus
  documentationUrl: string | null
  skillCount: number
  cooperationCount: number
  isMock: boolean
  updatedAt: string
}

export interface ProductDto extends ProductListItemDto {
  description: string | null
  skills: ProductSkillDto[]
  createdAt: string
}
