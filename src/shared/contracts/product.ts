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
  /** Компания-вендор (решение 132); null — не указан. */
  vendor: { id: string; name: string } | null
  isMock: boolean
  updatedAt: string
}

export interface ProductDto extends ProductListItemDto {
  description: string | null
  skills: ProductSkillDto[]
  createdAt: string
}

/** Связка, которую затронет или затронул выпуск новой версии продукта. */
export interface ProductReleaseTargetDto {
  cooperationId: string
  universityName: string
  programName: string
  stageNumber: number
  stageStatus: string
  /** Что произойдёт или произошло с этой связкой. */
  effect: 'task-added' | 'stage-reopened' | 'skipped-cancelled'
  reason: string
}

/** Предпросмотр групповой операции: что изменится, до того как менять. */
export interface ProductReleasePreviewDto {
  productId: string
  productName: string
  currentVersion: string | null
  nextVersion: string
  targets: ProductReleaseTargetDto[]
  affectedCooperations: number
  reopenedStages: number
  skipped: number
}

export interface ProductReleaseResultDto extends ProductReleasePreviewDto {
  appliedAt: string
}
