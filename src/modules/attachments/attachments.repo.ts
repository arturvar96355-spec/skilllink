import { prisma } from '@/shared/db/prisma'
import type { Prisma } from '@/generated/prisma/client'
import type { AttachmentOwnerType } from '@/shared/contracts/attachment'

const userRefSelect = { id: true, fullName: true, role: true } satisfies Prisma.UserSelect

const select = {
  id: true,
  ownerType: true,
  ownerId: true,
  originalName: true,
  mime: true,
  size: true,
  sha256: true,
  uploadedAt: true,
  uploadedBy: { select: userRefSelect },
} satisfies Prisma.AttachmentSelect

export type AttachmentRow = Prisma.AttachmentGetPayload<{ select: typeof select }>
export type AttachmentWithKeyRow = AttachmentRow & { storageKey: string }

export async function findByOwner(
  ownerType: AttachmentOwnerType,
  ownerId: string,
): Promise<AttachmentRow[]> {
  return prisma.attachment.findMany({
    where: { ownerType, ownerId },
    select,
    orderBy: { uploadedAt: 'desc' },
  })
}

/** С ключом хранения — для скачивания и удаления файла с диска. */
export async function findById(id: string): Promise<AttachmentWithKeyRow | null> {
  return prisma.attachment.findUnique({ where: { id }, select: { ...select, storageKey: true } })
}

export interface CreateAttachmentInput {
  ownerType: AttachmentOwnerType
  ownerId: string
  originalName: string
  mime: string
  size: number
  sha256: string
  storageKey: string
  uploadedById: string
}

export async function create(data: CreateAttachmentInput): Promise<AttachmentRow> {
  return prisma.attachment.create({
    data: {
      ownerType: data.ownerType,
      ownerId: data.ownerId,
      originalName: data.originalName,
      mime: data.mime,
      size: data.size,
      sha256: data.sha256,
      storageKey: data.storageKey,
      uploadedBy: { connect: { id: data.uploadedById } },
    },
    select,
  })
}

export async function remove(id: string): Promise<void> {
  await prisma.attachment.delete({ where: { id } })
}
