import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { UserRole } from '@/shared/contracts/enums'

/**
 * Отчёты «по ТЗ» и «Каталог по ТЗ» через сами маршруты (решение 225, находка Codex 2):
 * представитель вуза получал каталог своего вуза прямым запросом — с внутренним
 * комментарием, ФИО менеджера и ответственными, хотя раздел «Отчёты» ему закрыт.
 * Теперь — 403 на любом формате, остальные роли — как раньше. База подменена.
 */

const mocks = vi.hoisted(() => ({
  user: null as CurrentUser | null,
  findTzRows: vi.fn(),
  findCatalogRows: vi.fn(),
  resolveFilterLabels: vi.fn(),
}))

vi.mock('@/shared/auth/current-user', () => ({ getCurrentUser: async () => mocks.user }))
vi.mock('@/modules/reports/reports.repo', () => ({
  findTzRows: mocks.findTzRows,
  findCatalogRows: mocks.findCatalogRows,
  resolveFilterLabels: mocks.resolveFilterLabels,
}))

const tzRoute = await import('./tz/route')
const catalogRoute = await import('./catalog/route')

const ROUTES = {
  tz: { handler: tzRoute.GET, path: '/api/reports/tz' },
  catalog: { handler: catalogRoute.GET, path: '/api/reports/catalog' },
} as const

const FORMATS = ['json', 'xlsx', 'csv'] as const

function as(role: UserRole, overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: `user-${role}`,
    email: `${role.toLowerCase()}@test.local`,
    fullName: role,
    role,
    universityId: role === 'UNIVERSITY_REP' ? 'uni-1' : null,
    ...overrides,
  }
}

const CATALOG_ROW = {
  university: { name: 'СПбГУТ', contacts: [{ fullName: 'Ветрова Ирина Павловна' }] },
  product: { name: 'Учебный стенд', vendor: { name: 'Вендор' } },
  contractNumber: 'Д-1',
  licenseSignedAt: new Date('2026-09-01T00:00:00Z'),
  licenseTermYears: 1,
  transferStatus: null,
  responsible: { fullName: 'Кириллов Пётр Андреевич' },
  comment: 'Внутренний комментарий сотрудников',
}

const TZ_ROW = {
  university: { name: 'СПбГУТ' },
  program: { name: 'Программная инженерия' },
  product: { name: 'Учебный стенд' },
  status: 'ACTIVE',
  responsible: { fullName: 'Кириллов Пётр Андреевич' },
}

async function call(route: keyof typeof ROUTES, format: (typeof FORMATS)[number]): Promise<Response> {
  const { handler, path } = ROUTES[route]
  return handler(new Request(`http://localhost${path}?format=${format}`), undefined as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findTzRows.mockResolvedValue([TZ_ROW])
  mocks.findCatalogRows.mockResolvedValue([CATALOG_ROW])
  mocks.resolveFilterLabels.mockResolvedValue({})
})

describe('представитель вуза — 403 на всех форматах, база не читается', () => {
  for (const route of ['tz', 'catalog'] as const) {
    it.each(FORMATS)(`${route}: %s`, async (format) => {
      mocks.user = as('UNIVERSITY_REP')
      const response = await call(route, format)
      const body = (await response.json()) as { error: { code: string } }

      expect(response.status).toBe(403)
      expect(body.error.code).toBe('FORBIDDEN')
      expect(mocks.findTzRows).not.toHaveBeenCalled()
      expect(mocks.findCatalogRows).not.toHaveBeenCalled()
      expect(mocks.resolveFilterLabels).not.toHaveBeenCalled()
    })
  }

  it('эксперт-представитель — тоже 403', async () => {
    mocks.user = as('UNIVERSITY_REP', { isReviewer: true })
    expect((await call('catalog', 'json')).status).toBe(403)
  })
})

describe('сотрудники — как раньше', () => {
  for (const role of ['ADMIN', 'MANAGER', 'HEAD', 'ANALYST', 'VIEWER'] as const) {
    it.each(FORMATS)(`${role}: каталог и отчёт по ТЗ, %s — 200`, async (format) => {
      mocks.user = as(role)
      for (const route of ['tz', 'catalog'] as const) {
        const response = await call(route, format)
        expect(response.status).toBe(200)
      }
    })
  }

  it('каталог в json — с комментарием и ФИО менеджера, область видимости — без сужения', async () => {
    mocks.user = as('MANAGER')
    const response = await call('catalog', 'json')
    const text = await response.text()

    expect(text).toContain('Внутренний комментарий сотрудников')
    expect(text).toContain('Кириллов Пётр Андреевич')
    expect(mocks.findCatalogRows).toHaveBeenCalledWith(expect.any(Object), {})
  })

  it('эксперт-администратор читает отчёты (только чтение, решение 147)', async () => {
    mocks.user = as('ADMIN', { isReviewer: true })
    expect((await call('catalog', 'xlsx')).status).toBe(200)
    expect((await call('tz', 'csv')).status).toBe(200)
  })
})
