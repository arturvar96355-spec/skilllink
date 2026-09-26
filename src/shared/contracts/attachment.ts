import type { UserRefDto } from './workflow'

/**
 * Файлы к документам и этапам (решение 145, ТЗ функц. требования п.3).
 */
export const ATTACHMENT_OWNER_TYPES = ['DOCUMENT', 'STAGE'] as const
export type AttachmentOwnerType = (typeof ATTACHMENT_OWNER_TYPES)[number]

export interface AttachmentDto {
  id: string
  ownerType: AttachmentOwnerType
  ownerId: string
  originalName: string
  mime: string
  /** Байт. */
  size: number
  /** SHA-256 содержимого, hex — контроль целостности и справка о совпадении файлов. */
  sha256: string
  uploadedBy: UserRefDto | null
  uploadedAt: string
}
