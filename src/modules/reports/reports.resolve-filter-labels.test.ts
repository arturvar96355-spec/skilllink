import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * resolveFilterLabels — имена фильтров для шапки файла отчёта (решение 172,
 * исправление 187, находка ревью 27.09): раньше id из фильтра переводился в
 * имя без проверки области видимости — представитель вуза через
 * `?programId=<чужой>`/`?productId=<чужой>`/`?responsibleId=<любой>&format=csv`
 * получал в шапке файла название чужой программы/продукта или ФИО
 * произвольного сотрудника, хотя сама выборка строк по такому фильтру у него
 * всё равно пуста (`buildReportWhere`) — непроверенным оставался только id
 * в шапке.
 */
const db = vi.hoisted(() => ({
  university: { findUnique: vi.fn() },
  educationalProgram: { findFirst: vi.fn() },
  iTProduct: { findFirst: vi.fn() },
  user: { findUnique: vi.fn() },
}))

vi.mock('@/shared/db/prisma', () => ({ prisma: db }))

const repo = await import('./reports.repo')

beforeEach(() => {
  vi.clearAllMocks()
  db.university.findUnique.mockResolvedValue({ name: 'СПбГУТ' })
  db.educationalProgram.findFirst.mockResolvedValue({ name: 'Программная инженерия' })
  db.iTProduct.findFirst.mockResolvedValue({ name: 'Продукт' })
  db.user.findUnique.mockResolvedValue({ fullName: 'Иванова Мария' })
})

const filters = { programId: 'p1', productId: 'pr1', responsibleId: 'r1' }

describe('resolveFilterLabels: без ограничения области видимости (не UNIVERSITY_REP)', () => {
  it('программа и продукт ищутся без доп. условия по вузу', async () => {
    await repo.resolveFilterLabels(filters, {}, true)
    expect(db.educationalProgram.findFirst).toHaveBeenCalledWith({ where: { id: 'p1' }, select: { name: true } })
    expect(db.iTProduct.findFirst).toHaveBeenCalledWith({ where: { id: 'pr1' }, select: { name: true } })
  })

  it('право видеть сотрудников есть — ФИО ответственного резолвится', async () => {
    const labels = await repo.resolveFilterLabels(filters, {}, true)
    expect(labels.responsibleName).toBe('Иванова Мария')
  })

  it('права видеть сотрудников нет — ФИО ответственного не резолвится, даже без сужения по вузу', async () => {
    const labels = await repo.resolveFilterLabels(filters, {}, false)
    expect(labels.responsibleName).toBeUndefined()
    expect(db.user.findUnique).not.toHaveBeenCalled()
  })
})

describe('resolveFilterLabels: область видимости представителя вуза', () => {
  const scope = { universityId: 'own' }

  it('программа ищется в границах своего вуза', async () => {
    await repo.resolveFilterLabels(filters, scope, true)
    expect(db.educationalProgram.findFirst).toHaveBeenCalledWith({
      where: { id: 'p1', universityId: 'own' },
      select: { name: true },
    })
  })

  it('программа чужого вуза — не резолвится (findFirst с сужением ничего не находит)', async () => {
    db.educationalProgram.findFirst.mockResolvedValue(null)
    const labels = await repo.resolveFilterLabels(filters, scope, true)
    expect(labels.programName).toBeUndefined()
  })

  it('продукт ищется среди тех, что есть в связках своего вуза', async () => {
    await repo.resolveFilterLabels(filters, scope, true)
    expect(db.iTProduct.findFirst).toHaveBeenCalledWith({
      where: { id: 'pr1', cooperations: { some: { universityId: 'own' } } },
      select: { name: true },
    })
  })

  it('продукт, не связанный со своим вузом — не резолвится', async () => {
    db.iTProduct.findFirst.mockResolvedValue(null)
    const labels = await repo.resolveFilterLabels(filters, scope, true)
    expect(labels.productName).toBeUndefined()
  })

  it('представителю вуза (нет права ANALYTICS) ФИО ответственного не отдаётся — как и GET /api/users', async () => {
    const labels = await repo.resolveFilterLabels(filters, scope, false)
    expect(labels.responsibleName).toBeUndefined()
    expect(db.user.findUnique).not.toHaveBeenCalled()
  })
})

describe('resolveFilterLabels: чужой вуз в фильтре — ничего не резолвится', () => {
  it('запрошен вуз вне области видимости — buildReportWhere даёт null, запросы не идут', async () => {
    const labels = await repo.resolveFilterLabels({ ...filters, universityId: 'other' }, { universityId: 'own' }, true)
    expect(labels).toEqual({})
    expect(db.educationalProgram.findFirst).not.toHaveBeenCalled()
    expect(db.iTProduct.findFirst).not.toHaveBeenCalled()
    expect(db.user.findUnique).not.toHaveBeenCalled()
  })
})
