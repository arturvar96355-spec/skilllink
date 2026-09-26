import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { UserRole } from '@/shared/contracts/enums'
import { expectRejectCode } from '@/shared/testing/expect-code'
import { catalogNameKey } from '@/shared/utils/contacts'
import { parseChannels, parseProductCell } from './vendors.rules'
import type { VendorImportStep } from './vendors.repo'

/**
 * Вендоры (решение 132): разбор ячеек, загрузка из xlsx и CSV, повторная загрузка
 * без дублей, права, скрытие почты и телефона контактов (решение 106).
 * База подменена каталогом в памяти, в который «применяются» шаги загрузки.
 */

interface Catalog {
  vendors: Array<{ id: string; name: string; nameKey: string }>
  products: Array<{ id: string; name: string; vendorId: string | null; vendor: { name: string } | null }>
  contacts: Array<{
    id: string
    vendorId: string
    fullName: string
    email: string | null
    phone: string | null
    preferredChannels: Array<'EMAIL' | 'TELEGRAM' | 'PHONE'>
    products: Array<{ productId: string }>
  }>
}

const state = vi.hoisted(() => ({ catalog: { vendors: [], products: [], contacts: [] } as unknown as Catalog, seq: 0 }))

const repo = vi.hoisted(() => ({
  loadCatalog: vi.fn(async () => structuredClone(state.catalog)),
  applyImport: vi.fn(async (steps: VendorImportStep[]) => {
    const ids = new Map<string, string>()
    const resolve = (ref: string) => ids.get(ref) ?? ref
    const next = () => `id-${(state.seq += 1)}`
    for (const step of steps) {
      if (step.kind === 'vendor') {
        const id = next()
        ids.set(step.ref, id)
        state.catalog.vendors.push({ id, name: step.name, nameKey: step.nameKey })
      } else if (step.kind === 'product-create') {
        const id = next()
        ids.set(step.ref, id)
        const vendor = state.catalog.vendors.find((item) => item.id === resolve(step.vendorRef))!
        state.catalog.products.push({ id, name: step.name, vendorId: vendor.id, vendor: { name: vendor.name } })
      } else if (step.kind === 'product-link') {
        const product = state.catalog.products.find((item) => item.id === step.productId)!
        const vendor = state.catalog.vendors.find((item) => item.id === resolve(step.vendorRef))!
        product.vendorId = vendor.id
        product.vendor = { name: vendor.name }
      } else if (step.kind === 'contact-create') {
        state.catalog.contacts.push({
          id: next(),
          vendorId: resolve(step.vendorRef),
          fullName: step.fullName,
          email: step.email,
          phone: step.phone,
          preferredChannels: step.channels,
          products: step.productRefs.map((ref) => ({ productId: resolve(ref) })),
        })
      } else {
        const contact = state.catalog.contacts.find((item) => item.id === step.contactId)!
        Object.assign(contact, {
          email: step.email,
          phone: step.phone,
          preferredChannels: step.channels,
          products: step.productRefs.map((ref) => ({ productId: resolve(ref) })),
        })
      }
    }
  }),
  findById: vi.fn(),
  findMany: vi.fn(),
}))
const audit = vi.hoisted(() => ({ writeAudit: vi.fn() }))

vi.mock('./vendors.repo', () => repo)
vi.mock('@/shared/audit/audit', () => audit)

const { importVendors, getById, list } = await import('./vendors.service')

const XLSX = readFileSync(join(process.cwd(), 'tests/fixtures/vendors.sample.xlsx'))

function user(role: UserRole): CurrentUser {
  return { id: `u-${role}`, email: `${role}@example.invalid`, fullName: 'Сотрудник', role, universityId: role === 'UNIVERSITY_REP' ? 'uni-1' : null }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.seq = 0
  state.catalog = {
    vendors: [],
    // «Гамма Шлюз» уже есть в реестре без вендора — загрузка привяжет, а не задублирует.
    products: [{ id: 'p-gamma', name: 'Гамма  шлюз', vendorId: null, vendor: null }],
    contacts: [],
  }
})

describe('разбор ячеек файла вендоров', () => {
  it('несколько продуктов в ячейке: «A», «B»', () => {
    expect(parseProductCell('«RT.DataLake», «RT.Warehouse»')).toEqual(['RT.DataLake', 'RT.Warehouse'])
    expect(parseProductCell('«Базис Dynamix»')).toEqual(['Базис Dynamix'])
    expect(parseProductCell('Продукт, с запятой')).toEqual(['Продукт, с запятой'])
    expect(parseProductCell('Один; Два')).toEqual(['Один', 'Два'])
    expect(parseProductCell('«Яга», «яга»')).toEqual(['Яга'])
    expect(parseProductCell(null)).toEqual([])
  })

  it('способ связи → перечисление; неизвестное слово — не молчаливый пропуск', () => {
    expect(parseChannels('Почта, Чат в ТГ')).toEqual({ channels: ['EMAIL', 'TELEGRAM'], unknown: [] })
    expect(parseChannels('чат в тг')).toEqual({ channels: ['TELEGRAM'], unknown: [] })
    expect(parseChannels('Телефон; e-mail')).toEqual({ channels: ['PHONE', 'EMAIL'], unknown: [] })
    expect(parseChannels('Вотсап')).toEqual({ channels: [], unknown: ['Вотсап'] })
  })
})

describe('загрузка вендоров из xlsx', () => {
  it('предпросмотр: что создастся, что обновится, ошибки со строкой и колонкой', async () => {
    const result = await importVendors(user('MANAGER'), { mode: 'preview' }, XLSX)
    expect(repo.applyImport).not.toHaveBeenCalled()
    expect(result).toMatchObject({ mode: 'preview', format: 'xlsx', sheet: 'Лист1', totalRows: 6 })
    expect(result.toCreate.vendors).toEqual(['ООО «Альфа Софт»', 'ООО «Бета Данные»', 'ООО «Гамма ИТ»'])
    expect(result.toCreate.products).toEqual(['Альфа Платформа', 'Beta.Lake', 'Beta.Store', 'Гамма SDK'])
    expect(result.toUpdate.products).toEqual([{ name: 'Гамма  шлюз', change: 'Будет привязан к вендору ООО «Гамма ИТ»' }])
    // Сидоров во второй строке (строка 6) — тот же контакт той же компании: одна запись.
    expect(result.toCreate.contacts).toEqual([
      'Сидоров Семён Семёнович',
      'Петрова Полина Павловна',
      'Васильев Василий Васильевич',
      'Николаева Нина Николаевна',
    ])
    expect(result.errors).toEqual([
      { row: 8, column: 'Телефон', message: expect.stringContaining('не распознан') },
      { row: 8, column: 'Почта', message: 'Адрес не похож на почту' },
      { row: 8, column: 'Способ связи', message: expect.stringContaining('Вотсап') },
    ])
    expect(result.quality).toMatchObject({ phonesNormalized: 4, emailsLowercased: 1, multiProductCells: 1, productsMatched: 1 })
  })

  it('apply, затем повторная загрузка того же файла — ничего нового', async () => {
    const applied = await importVendors(user('ADMIN'), { mode: 'apply' }, XLSX)
    expect(repo.applyImport).toHaveBeenCalledTimes(1)
    expect(state.catalog.vendors).toHaveLength(3)
    expect(state.catalog.products).toHaveLength(5)
    const petrova = state.catalog.contacts.find((contact) => contact.fullName.startsWith('Петрова'))!
    expect(petrova).toMatchObject({ phone: '+79000002233', email: 'petrova.pp@example.invalid', preferredChannels: ['TELEGRAM'] })
    expect(petrova.products).toHaveLength(2)
    const vasiliev = state.catalog.contacts.find((contact) => contact.fullName.startsWith('Васильев'))!
    expect(vasiliev.phone).toBe('+79000003344')
    expect(vasiliev.products).toEqual([{ productId: 'p-gamma' }])
    const sidorov = state.catalog.contacts.find((contact) => contact.fullName.startsWith('Сидоров'))!
    expect(sidorov.preferredChannels).toEqual(['EMAIL', 'TELEGRAM'])

    // Журнал — только счётчики.
    const entry = audit.writeAudit.mock.calls[0]![0]
    expect(entry).toMatchObject({ action: 'import.vendors', payload: { vendorsCreated: 3, contactsCreated: 4 } })
    expect(JSON.stringify(entry)).not.toMatch(/Сидоров|example\.invalid|\+7900/)
    expect(applied.errors).toHaveLength(3)

    const again = await importVendors(user('ADMIN'), { mode: 'apply' }, XLSX)
    expect(again.toCreate).toEqual({ vendors: [], products: [], contacts: [] })
    expect(again.toUpdate).toEqual({ products: [], contacts: [] })
    expect(again.unchanged).toEqual({ products: 5, contacts: 4 })
    expect(state.catalog.vendors).toHaveLength(3)
    expect(state.catalog.contacts).toHaveLength(4)
  })

  it('продукт другого вендора не перепривязывается — ошибка строки', async () => {
    state.catalog.vendors.push({ id: 'v-x', name: 'ООО «Иной»', nameKey: catalogNameKey('ООО «Иной»') })
    state.catalog.products[0] = { id: 'p-gamma', name: 'Гамма Шлюз', vendorId: 'v-x', vendor: { name: 'ООО «Иной»' } }
    const result = await importVendors(user('MANAGER'), { mode: 'preview' }, XLSX)
    expect(result.errors).toContainEqual({ row: 4, column: 'Продукт', message: expect.stringContaining('уже привязан к вендору ООО «Иной»') })
    expect(result.toCreate.contacts).not.toContain('Васильев Василий Васильевич')
  })

  it('CSV тоже принимается, разделитель «;»', async () => {
    const csv = 'Компания;Продукт;ФИО;Телефон;Почта;Способ связи\r\nООО «Эпсилон»;«Эпсилон ИИ»;Тестов Тест;8 900 000 55 66;T@Example.Invalid;Телефон\r\n'
    const result = await importVendors(user('MANAGER'), { mode: 'preview' }, Buffer.from(csv, 'utf8'))
    expect(result).toMatchObject({ format: 'csv', encoding: 'utf-8', sheet: null })
    expect(result.toCreate).toEqual({ vendors: ['ООО «Эпсилон»'], products: ['Эпсилон ИИ'], contacts: ['Тестов Тест'] })
  })

  it('без колонки «Компания» — отказ с перечнем колонок', async () => {
    await expectRejectCode(importVendors(user('MANAGER'), { mode: 'preview' }, Buffer.from('Продукт;ФИО\r\nА;Б\r\n')), 'VALIDATION_ERROR')
  })

  it.each(['ANALYST', 'VIEWER', 'UNIVERSITY_REP'] as const)('%s не загружает вендоров — 403', async (role) => {
    await expectRejectCode(importVendors(user(role), { mode: 'preview' }, XLSX), 'FORBIDDEN')
    expect(repo.loadCatalog).not.toHaveBeenCalled()
  })
})

describe('карточка и реестр вендоров', () => {
  const ROW = {
    id: 'v-1',
    name: 'ООО «Базис»',
    isMock: true,
    createdAt: new Date('2026-09-01'),
    updatedAt: new Date('2026-09-02'),
    products: [
      {
        id: 'p-1',
        name: 'Базис Dynamix',
        category: 'Виртуализация',
        version: null,
        status: 'ACTIVE',
        _count: { cooperations: 1 },
        schoolCourses: [{ id: 'c-1', name: 'Курс', productId: 'p-1' }],
        cooperations: [
          { id: 'co-1', status: 'ACTIVE', university: { id: 'u-1', name: 'СПбГУТ' }, program: { id: 'pr-1', name: 'Программа' } },
        ],
      },
    ],
    contacts: [
      {
        id: 'vc-1',
        fullName: 'Орлова Вера Николаевна',
        email: 'orlova@example.invalid',
        phone: '+79000000101',
        preferredChannels: ['EMAIL'],
        legalBasis: 'LEGITIMATE_INTEREST',
        products: [{ productId: 'p-1' }],
      },
    ],
  }

  it('менеджер видит почту и телефон контакта, связки и курсы через продукты', async () => {
    repo.findById.mockResolvedValue(ROW)
    const card = await getById(user('MANAGER'), 'v-1')
    expect(card.contacts[0]).toMatchObject({ email: 'orlova@example.invalid', phone: '+79000000101', contactDetailsHidden: false, productIds: ['p-1'] })
    expect(card.cooperations).toEqual([
      expect.objectContaining({ id: 'co-1', universityName: 'СПбГУТ', productName: 'Базис Dynamix' }),
    ])
    expect(card.courses).toEqual([{ id: 'c-1', name: 'Курс', productId: 'p-1' }])
  })

  it.each(['ANALYST', 'VIEWER'] as const)('%s видит ФИО, но не почту и телефон (решение 106)', async (role) => {
    repo.findById.mockResolvedValue(ROW)
    const card = await getById(user(role), 'v-1')
    expect(card.contacts[0]).toMatchObject({ fullName: 'Орлова Вера Николаевна', email: null, phone: null, contactDetailsHidden: true })
    expect(JSON.stringify(card)).not.toContain('orlova@')
  })

  it('представителю вуза вендоры недоступны: там связки со всеми вузами', async () => {
    await expectRejectCode(getById(user('UNIVERSITY_REP'), 'v-1'), 'FORBIDDEN')
    await expectRejectCode(list(user('UNIVERSITY_REP'), { page: 1, pageSize: 20 }), 'FORBIDDEN')
  })

  it('нет вендора — 404', async () => {
    repo.findById.mockResolvedValue(null)
    await expectRejectCode(getById(user('MANAGER'), 'nope'), 'NOT_FOUND')
  })
})
