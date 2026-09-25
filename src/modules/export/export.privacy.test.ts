import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import { canSeeContactDetails } from '@/shared/auth/permissions'
import type { UserRole } from '@/shared/contracts/enums'
import type { UniversityListItemDto } from '@/shared/contracts/university'
import { CONTACT_HEADERS, UTF8_BOM, auditFilters, contactCells } from './export.rules'

/**
 * Персональные данные в выгрузке (аудит S-17, docs/PRIVACY.md):
 * почта контакта — только ADMIN и MANAGER, в журнал — что и откуда выгрузили,
 * но без самих данных.
 *
 * База и сервис реестра подменяются: проверяется сборка файла и записи журнала.
 */
const db = vi.hoisted(() => ({ university: { findMany: vi.fn() } }))
const universities = vi.hoisted(() => ({ list: vi.fn() }))
const audit = vi.hoisted(() => ({ writeAudit: vi.fn() }))

vi.mock('@/shared/db/prisma', () => ({ prisma: db }))
vi.mock('@/modules/universities/universities.service', () => universities)
vi.mock('@/shared/audit/audit', () => audit)

const { exportDataset } = await import('./export.service')

const ROLES: UserRole[] = ['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER', 'UNIVERSITY_REP']

function user(role: UserRole): CurrentUser {
  return {
    id: `u-${role}`,
    email: `${role.toLowerCase()}@example.invalid`,
    fullName: 'Тестовый Пользователь',
    role,
    universityId: role === 'UNIVERSITY_REP' ? 'uni-1' : null,
  }
}

const CONTACT = {
  fullName: 'Ветрова Ирина Павловна',
  position: 'Заместитель декана',
  email: 'vetrova@example.invalid',
  legalBasis: 'LEGITIMATE_INTEREST',
}

const ROW: UniversityListItemDto = {
  id: 'uni-1',
  name: 'Тестовый университет связи',
  shortName: 'ТУС',
  city: 'Москва',
  region: 'Москва',
  status: 'ACTIVE',
  programCount: 2,
  cooperationCount: 1,
  activeCooperationCount: 1,
  isMock: true,
  rating: null,
  updatedAt: '2026-09-21T10:00:00.000Z',
  archivedAt: null,
}

/** Значение колонки в первой строке данных файла. */
function cell(csv: string, header: string): string {
  const [head, first] = csv.replace(UTF8_BOM, '').split('\r\n')
  const index = head!.split(';').indexOf(header)
  expect(index, `нет колонки ${header}`).toBeGreaterThanOrEqual(0)
  return first!.split(';')[index]!
}

beforeEach(() => {
  universities.list.mockReset().mockResolvedValue({ data: [ROW], meta: { page: 1, pageSize: 1000, total: 1 } })
  db.university.findMany.mockReset().mockResolvedValue([
    { id: 'uni-1', directionCount: 5, studentCount: 1000, website: null, contacts: [CONTACT] },
  ])
  audit.writeAudit.mockReset()
})

describe('кто видит почту контакта в выгрузке', () => {
  it.each(ROLES)('%s', (role) => {
    expect(canSeeContactDetails(user(role))).toBe(role === 'ADMIN' || role === 'MANAGER')
  })

  it('ячейки контакта: почта только с правом', () => {
    expect(contactCells(CONTACT, true)).toEqual([CONTACT.fullName, CONTACT.position, CONTACT.email, true])
    expect(contactCells(CONTACT, false)).toEqual([CONTACT.fullName, CONTACT.position, null, true])
    expect(contactCells(undefined, true)).toEqual([null, null, null, null])
  })

  it('признак основания: «да»/«нет», без самого основания и документа', () => {
    expect(contactCells({ ...CONTACT, legalBasis: null }, true)[3]).toBe(false)
    expect(contactCells(CONTACT, false)[3]).toBe(true)
  })
})

describe('выгрузка вузов', () => {
  const request = { dataset: 'universities' as const, limit: 1000, filters: { page: 1, pageSize: 20 } }

  it.each(['ADMIN', 'MANAGER'] as const)('%s получает почту основного контакта', async (role) => {
    const result = await exportDataset(user(role), request as never, { address: '203.0.113.7' })
    expect(cell(result.csv, 'Почта')).toBe(CONTACT.email)
  })

  it.each(['ANALYST', 'VIEWER', 'UNIVERSITY_REP'] as const)(
    '%s: колонка «Почта» есть, но пустая, ФИО и должность — на месте',
    async (role) => {
      const result = await exportDataset(user(role), request as never, { address: '203.0.113.7' })
      expect(result.csv).not.toContain(CONTACT.email)
      expect(cell(result.csv, 'Почта')).toBe('')
      expect(cell(result.csv, 'Контактное лицо')).toBe(CONTACT.fullName)
      expect(cell(result.csv, 'Основание обработки ПД зафиксировано')).toBe('да')
      expect(result.csv).not.toContain('LEGITIMATE_INTEREST')
    },
  )

  it('состав колонок одинаков для всех ролей, кроме рейтинга', async () => {
    const headers = async (role: UserRole) => {
      const { csv } = await exportDataset(user(role), request as never, { address: 'unknown' })
      return csv.replace(UTF8_BOM, '').split('\r\n')[0]!.split(';').filter((name) => !name.includes('ейтинг') && name !== 'Учтено программ')
    }
    expect(await headers('VIEWER')).toEqual(await headers('ADMIN'))
    expect(await headers('ADMIN')).toEqual(expect.arrayContaining(CONTACT_HEADERS))
  })
})

describe('журнал выгрузки', () => {
  it('набор, фильтры, число строк и адрес клиента — без персональных данных', async () => {
    const request = {
      dataset: 'universities' as const,
      limit: 500,
      filters: { page: 1, pageSize: 20, q: 'Ветрова', status: ['ACTIVE'], region: ['Москва'] },
    }
    await exportDataset(user('MANAGER'), request as never, { address: '203.0.113.7' })

    expect(audit.writeAudit).toHaveBeenCalledTimes(1)
    const entry = audit.writeAudit.mock.calls[0]?.[0]
    expect(entry).toMatchObject({
      userId: 'u-MANAGER',
      action: 'export.download',
      objectType: 'Export',
      objectId: 'universities',
      payload: {
        dataset: 'universities',
        rows: 1,
        limit: 500,
        filters: { q: true, status: ['ACTIVE'], region: ['Москва'] },
        address: '203.0.113.7',
      },
    })
    const serialized = JSON.stringify(entry)
    for (const value of ['Ветрова', CONTACT.email, CONTACT.position]) {
      expect(serialized).not.toContain(value)
    }
  })

  it('фильтры: строка поиска — только признаком, страница не пишется', () => {
    expect(auditFilters({ q: 'Иванов', page: 2, pageSize: 50, onlyBlocked: true, sort: '-updatedAt' })).toEqual({
      q: true,
      onlyBlocked: true,
      sort: '-updatedAt',
    })
    expect(auditFilters({ q: undefined })).toEqual({})
  })
})
