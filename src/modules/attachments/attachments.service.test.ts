import { describe, it } from 'vitest'
import { expectRejectCode } from '@/shared/testing/expect-code'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { UploadedFile } from '@/shared/http/request'
import * as service from './attachments.service'

/**
 * Права загрузки и удаления файлов — как у изменения документа/этапа: только
 * `WRITE` (ADMIN, MANAGER). Проверка прав в сервисе идёт раньше любого обращения
 * к базе (`assertCan` — первая строка `upload`/`remove`), поэтому тест не поднимает
 * базу: запрос к несуществующему владельцу до базы просто не доходит.
 */

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
