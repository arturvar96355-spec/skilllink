import { createHash } from 'node:crypto'
import { assertCan, isUniversityVisible, universityScope } from '@/shared/auth/permissions'
import { notFound } from '@/shared/http/errors'
import { writeAudit } from '@/shared/audit/audit'
import { toIsoRequired } from '@/shared/utils/date'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { UploadedFile } from '@/shared/http/request'
import type { AttachmentDto, AttachmentOwnerType } from '@/shared/contracts/attachment'
import {
  deleteAttachmentFile,
  readAttachmentFile,
  writeAttachmentFile,
} from '@/shared/files/attachment-storage'
import { mimeForExtension } from '@/shared/config/attachments.config'
import * as documentsRepo from '@/modules/documents/documents.repo'
import * as workflowRepo from '@/modules/workflow/workflow.repo'
import * as repo from './attachments.repo'
import { assertValidAttachment } from './attachments.rules'

/**
 * Файлы к документам и этапам (решение 145, ТЗ функц. требования п.3).
 *
 * Права — как у изменения самого владельца (`documents.service.update`,
 * `workflow.service.updateStage`): загрузка и удаление — `WRITE` (ADMIN, MANAGER),
 * список и скачивание — `READ`, представителю вуза — только свой вуз
 * (`universityScope`/`isUniversityVisible`, как у самих документов и этапов).
 */

function toDto(row: repo.AttachmentRow): AttachmentDto {
  return {
    id: row.id,
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    originalName: row.originalName,
    mime: row.mime,
    size: row.size,
    sha256: row.sha256,
    uploadedBy: row.uploadedBy,
    uploadedAt: toIsoRequired(row.uploadedAt),
  }
}

/** Существование владельца и видимость его вуза — общая проверка для чтения и записи. */
async function assertOwnerVisible(
  user: CurrentUser,
  ownerType: AttachmentOwnerType,
  ownerId: string,
): Promise<void> {
  if (ownerType === 'DOCUMENT') {
    const ref = await documentsRepo.findRef(ownerId, universityScope(user))
    if (!ref) throw notFound('Документ не найден')
    return
  }
  const ref = await workflowRepo.findStageRef(ownerId)
  if (!ref || !isUniversityVisible(user, ref.universityId)) throw notFound('Этап не найден')
}

export async function list(
  user: CurrentUser,
  ownerType: AttachmentOwnerType,
  ownerId: string,
): Promise<AttachmentDto[]> {
  assertCan(user, 'READ')
  await assertOwnerVisible(user, ownerType, ownerId)
  const rows = await repo.findByOwner(ownerType, ownerId)
  return rows.map(toDto)
}

export async function upload(
  user: CurrentUser,
  ownerType: AttachmentOwnerType,
  ownerId: string,
  file: UploadedFile,
): Promise<AttachmentDto> {
  assertCan(user, 'WRITE')
  await assertOwnerVisible(user, ownerType, ownerId)
  const extension = assertValidAttachment(file)

  const sha256 = createHash('sha256').update(file.bytes).digest('hex')
  const { storageKey } = await writeAttachmentFile(file.bytes)

  const row = await repo.create({
    ownerType,
    ownerId,
    originalName: file.name,
    // Не file.type клиента — сервер сам знает тип по расширению, которое уже
    // подтверждено сигнатурой в assertValidAttachment (решение 173, проблема 16).
    mime: mimeForExtension(extension),
    size: file.size,
    sha256,
    storageKey,
    uploadedById: user.id,
  })

  await writeAudit({
    userId: user.id,
    action: 'file.uploaded',
    objectType: 'Attachment',
    objectId: row.id,
    payload: { ownerType, ownerId, size: row.size, sha256: row.sha256 },
  })

  return toDto(row)
}

export interface AttachmentDownload {
  attachment: AttachmentDto
  bytes: Buffer
}

export async function download(user: CurrentUser, id: string): Promise<AttachmentDownload> {
  assertCan(user, 'READ')
  const row = await repo.findById(id)
  if (!row) throw notFound('Файл не найден')
  await assertOwnerVisible(user, row.ownerType, row.ownerId)

  const bytes = await readAttachmentFile(row.storageKey)
  return { attachment: toDto(row), bytes }
}

export async function remove(user: CurrentUser, id: string): Promise<{ id: string }> {
  assertCan(user, 'WRITE')
  const row = await repo.findById(id)
  if (!row) throw notFound('Файл не найден')
  await assertOwnerVisible(user, row.ownerType, row.ownerId)

  await repo.remove(id)
  await deleteAttachmentFile(row.storageKey)

  await writeAudit({
    userId: user.id,
    action: 'file.deleted',
    objectType: 'Attachment',
    objectId: id,
    payload: { ownerType: row.ownerType, ownerId: row.ownerId },
  })

  return { id }
}
