import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectRejectCode } from '@/shared/testing/expect-code'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { UploadedFile } from '@/shared/http/request'
import type { CreateAttachmentInput } from './attachments.repo'

/**
 * Права загрузки и удаления файлов — как у изменения документа/этапа: только
 * `WRITE` (ADMIN, MANAGER). Проверка прав в сервисе идёт раньше любого обращения
 * к базе (`assertCan` — первая строка `upload`/`remove`), поэтому тест не поднимает
 * базу: запрос к несуществующему владельцу до базы просто не доходит.
 *
 * Мимо этих проверок база всё же нужна была бы для `upload()` целиком (решение 173,
 * проблема 16, ниже) — репозиторий, хранилище файлов и репозиторий документов
 * заменены моделью в памяти, без реального Prisma/диска.
 */

const mocks = vi.hoisted(() => ({
  create: vi.fn<(data: CreateAttachmentInput) => Promise<{ id: string; mime: string }>>(),
  findRef: vi.fn(),
  writeAttachmentFile: vi.fn(),
  writeAudit: vi.fn(),
}))

vi.mock('./attachments.repo', () => ({
  create: mocks.create,
  findByOwner: vi.fn(),
  findById: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/modules/documents/documents.repo', () => ({
  findRef: mocks.findRef,
}))

vi.mock('@/modules/workflow/workflow.repo', () => ({
  findStageRef: vi.fn(),
}))

vi.mock('@/shared/files/attachment-storage', () => ({
  writeAttachmentFile: mocks.writeAttachmentFile,
  readAttachmentFile: vi.fn(),
  deleteAttachmentFile: vi.fn(),
}))

vi.mock('@/shared/audit/audit', () => ({
  writeAudit: mocks.writeAudit,
}))

const service = await import('./attachments.service')

function user(role: CurrentUser['role'], universityId: string | null = null): CurrentUser {
  return { id: `u-${role}`, email: `${role}@test.local`, fullName: role, role, universityId }
}

const file: UploadedFile = {
  name: 'файл.png',
  type: 'image/png',
  size: 8,
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
}

describe('права загрузки и удаления файлов (решение 145)', () => {
  it.each(['ANALYST', 'VIEWER', 'UNIVERSITY_REP'] as const)(
    'роль %s не может загрузить файл (нет WRITE)',
    async (role) => {
      await expectRejectCode(service.upload(user(role), 'DOCUMENT', 'doc-1', file), 'FORBIDDEN')
    },
  )

  it.each(['ANALYST', 'VIEWER', 'UNIVERSITY_REP'] as const)(
    'роль %s не может удалить файл (нет WRITE)',
    async (role) => {
      await expectRejectCode(service.remove(user(role), 'attachment-1'), 'FORBIDDEN')
    },
  )
})

describe('Content-Type файла — по сигнатуре, не по словам клиента (решение 173, проблема 16)', () => {
  beforeEach(() => {
    mocks.create.mockReset()
    mocks.findRef.mockReset()
    mocks.writeAttachmentFile.mockReset()
    mocks.writeAudit.mockReset()
    mocks.findRef.mockResolvedValue({ id: 'doc-1', universityId: null })
    mocks.writeAttachmentFile.mockResolvedValue({ storageKey: 'ab/ab123' })
    mocks.create.mockImplementation(async (data: CreateAttachmentInput) => ({
      id: 'attachment-1',
      ownerType: data.ownerType,
      ownerId: data.ownerId,
      originalName: data.originalName,
      mime: data.mime,
      size: data.size,
      sha256: data.sha256,
      uploadedBy: { id: data.uploadedById, fullName: 'Тест', role: 'MANAGER' },
      uploadedAt: new Date(),
    }))
  })

  it('клиент лжёт про type — сервер сохраняет и отдаёт настоящий MIME по сигнатуре', async () => {
    const lyingFile: UploadedFile = { ...file, type: 'text/html' }
    const result = await service.upload(user('MANAGER'), 'DOCUMENT', 'doc-1', lyingFile)

    expect(result.mime).toBe('image/png')
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ mime: 'image/png' }))
  })

  it('клиент вовсе не прислал type ("") — сервер всё равно определяет его сам', async () => {
    const untypedFile: UploadedFile = { ...file, type: '' }
    const result = await service.upload(user('ADMIN'), 'DOCUMENT', 'doc-1', untypedFile)

    expect(result.mime).toBe('image/png')
  })
})
