import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { DocumentStatus } from '@/shared/contracts/enums'
import { readZip } from '@/shared/files/zip'
import { expectRejectCode } from '@/shared/testing/expect-code'

/**
 * Закрытый пакет документов открывается и скачивается (решение 212, п. 2).
 *
 * Эксперт открыл подписанные документы завершённой связки — и открыть было
 * нечего: ни файла документа, ни пакета целиком, только ссылка на внешний
 * адрес, которого не существует. До исправления `documentFile` и
 * `documentPackage` не было вовсе — эти проверки падали. Теперь закрытие
 * (подписан, в архиве, связка завершена) запрещает правку, а не чтение.
 */

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  findCooperationForPackage: vi.fn(),
  findCooperationDocuments: vi.fn(),
  findStoredByOwners: vi.fn(),
  readAttachmentFile: vi.fn(),
}))

vi.mock('./documents.repo', () => ({
  findById: mocks.findById,
  findCooperationForPackage: mocks.findCooperationForPackage,
  findCooperationDocuments: mocks.findCooperationDocuments,
}))
vi.mock('@/modules/attachments/attachments.repo', () => ({ findStoredByOwners: mocks.findStoredByOwners }))
vi.mock('@/shared/files/attachment-storage', () => ({ readAttachmentFile: mocks.readAttachmentFile }))
vi.mock('@/shared/audit/audit', () => ({ writeAudit: vi.fn() }))
vi.mock('@/modules/workflow/workflow.service', () => ({ markTasksBySignedDocuments: vi.fn() }))
vi.mock('@/modules/workflow/workflow.repo', () => ({ lockCooperation: vi.fn() }))

const { documentFile, documentPackage } = await import('./documents.service')

const manager: CurrentUser = { id: 'u-1', email: 'm@x.ru', fullName: 'Менеджер', role: 'MANAGER', universityId: null }
const expert: CurrentUser = {
  id: 'u-2',
  email: 'e@x.ru',
  fullName: 'Эксперт',
  role: 'VIEWER',
  universityId: null,
  isReviewer: true,
}
const rep: CurrentUser = { id: 'u-3', email: 'r@x.ru', fullName: 'Представитель', role: 'UNIVERSITY_REP', universityId: 'uni-1' }

const person = { id: 'u-1', fullName: 'Кириллов Пётр Андреевич', role: 'MANAGER' as const }

function documentRow(id: string, status: DocumentStatus, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'AGREEMENT' as const,
    title: 'Договор о сотрудничестве',
    version: '1',
    status,
    content: null,
    templateKey: null,
    fileReference: 'https://example.invalid/docs/agreement-1.pdf',
    issuedAt: new Date('2026-03-01T10:00:00Z'),
    signedAt: status === 'SIGNED' ? new Date('2026-03-10T10:00:00Z') : null,
    cooperationId: 'coop-1',
    universityId: 'uni-1',
    programId: 'prog-1',
    createdAt: new Date('2026-03-01T10:00:00Z'),
    updatedAt: new Date('2026-03-10T10:00:00Z'),
    author: person,
    responsible: person,
    university: { id: 'uni-1', name: 'Кубанский государственный технологический университет', shortName: 'КубГТУ' },
    program: { id: 'prog-1', name: 'Информационные системы' },
    history: [
      {
        id: `h-${id}`,
        fromStatus: 'APPROVED' as const,
        toStatus: status,
        comment: 'Внутренняя заметка',
        changedAt: new Date('2026-03-10T10:00:00Z'),
        changedBy: person,
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findStoredByOwners.mockResolvedValue([])
})

describe('файл документа открывается в любом статусе', () => {
  for (const status of ['DRAFT', 'REVIEW', 'APPROVED', 'SIGNED', 'REJECTED', 'ARCHIVED'] as const) {
    it(`статус ${status}: файл отдаётся`, async () => {
      mocks.findById.mockResolvedValue(documentRow('doc-1', status))
      const file = await documentFile(manager, 'doc-1')
      expect(file.mime).toBe('text/html; charset=utf-8')
      const html = file.bytes.toString('utf8')
      expect(html).toContain('Договор о сотрудничестве')
      expect(file.name).toMatch(/^Договор о сотрудничестве, версия 1 \(.+\)\.html$/)
    })
  }

  it('эксперт (только чтение) открывает подписанный документ', async () => {
    mocks.findById.mockResolvedValue(documentRow('doc-1', 'SIGNED'))
    await expect(documentFile(expert, 'doc-1')).resolves.toMatchObject({ mime: 'text/html; charset=utf-8' })
  })

  it('представителю вуза внутренние заметки истории не показываются', async () => {
    mocks.findById.mockResolvedValue(documentRow('doc-1', 'SIGNED'))
    const html = (await documentFile(rep, 'doc-1')).bytes.toString('utf8')
    expect(html).not.toContain('Внутренняя заметка')
    expect(mocks.findById).toHaveBeenCalledWith('doc-1', { universityId: 'uni-1' })
  })

  it('чужой или несуществующий документ — NOT_FOUND', async () => {
    mocks.findById.mockResolvedValue(null)
    await expectRejectCode(documentFile(rep, 'doc-x'), 'NOT_FOUND')
  })

  it('текст документа экранирован: разметка из шаблона не исполняется', async () => {
    mocks.findById.mockResolvedValue(documentRow('doc-1', 'SIGNED', { content: '<script>alert(1)</script>' }))
    const html = (await documentFile(manager, 'doc-1')).bytes.toString('utf8')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('демонстрационная ссылка на оригинал не выдаётся за рабочую', async () => {
    mocks.findById.mockResolvedValue(documentRow('doc-1', 'SIGNED'))
    const html = (await documentFile(manager, 'doc-1')).bytes.toString('utf8')
    expect(html).not.toContain('href="https://example.invalid')
    expect(html).toContain('демонстрационная')
  })
})

describe('пакет документов завершённой связки скачивается целиком', () => {
  it('подписанные и архивные документы с приложенными файлами — в одном архиве', async () => {
    mocks.findCooperationForPackage.mockResolvedValue({
      id: 'coop-1',
      university: { name: 'Кубанский государственный технологический университет', shortName: 'КубГТУ' },
      program: { name: 'Информационные системы' },
    })
    mocks.findCooperationDocuments.mockResolvedValue([
      documentRow('doc-1', 'SIGNED'),
      documentRow('doc-2', 'ARCHIVED', { title: 'Лицензия на IT-продукт' }),
    ])
    mocks.findStoredByOwners.mockResolvedValue([
      { id: 'f-1', ownerId: 'doc-1', originalName: 'Скан.pdf', size: 3, storageKey: 'k-1' },
      { id: 'f-2', ownerId: 'doc-1', originalName: 'Скан.pdf', size: 3, storageKey: 'k-2' },
    ])
    mocks.readAttachmentFile.mockImplementation(async (key: string) => Buffer.from(`pdf-${key}`))

    const file = await documentPackage(expert, 'coop-1')
    expect(file.mime).toBe('application/zip')
    expect(file.name).toBe('Документы связки — КубГТУ — Информационные системы.zip')

    const entries = readZip(file.bytes)
    const names = [...entries.keys()]
    expect(names).toContain('01 Договор о сотрудничестве, версия 1/Договор о сотрудничестве, версия 1 (Подписан).html')
    expect(names).toContain('02 Лицензия на IT-продукт, версия 1/Лицензия на IT-продукт, версия 1 (В архиве).html')
    // Два файла с одним именем не перезаписывают друг друга.
    expect(entries.get('01 Договор о сотрудничестве, версия 1/Скан.pdf')?.toString()).toBe('pdf-k-1')
    expect(entries.get('01 Договор о сотрудничестве, версия 1/f-2-Скан.pdf')?.toString()).toBe('pdf-k-2')
  })

  it('чужая связка для представителя вуза — NOT_FOUND', async () => {
    mocks.findCooperationForPackage.mockResolvedValue(null)
    await expectRejectCode(documentPackage(rep, 'coop-2'), 'NOT_FOUND')
    expect(mocks.findCooperationForPackage).toHaveBeenCalledWith('coop-2', { universityId: 'uni-1' })
  })

  it('документов нет — понятный отказ, а не пустой архив', async () => {
    mocks.findCooperationForPackage.mockResolvedValue({
      id: 'coop-1',
      university: { name: 'Вуз', shortName: null },
      program: { name: 'Программа' },
    })
    mocks.findCooperationDocuments.mockResolvedValue([])
    await expectRejectCode(documentPackage(manager, 'coop-1'), 'NOT_FOUND')
  })
})
