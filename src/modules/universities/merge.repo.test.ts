import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Репозиторий слияния вузов с подменённой базой (решение 134): перенос объектов
 * дубля к цели, какое значение поля записывается, что попадает в журнал слияния,
 * и что возвращается при отмене. Настоящая транзакция и блокировка — в пробнике.
 */
const db = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    university: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    educationalProgram: { findMany: vi.fn(), updateMany: vi.fn() },
    contact: { findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    cooperation: { findMany: vi.fn(), updateMany: vi.fn() },
    meeting: { findMany: vi.fn(), updateMany: vi.fn() },
    document: { findMany: vi.fn(), updateMany: vi.fn() },
    application: { findMany: vi.fn(), updateMany: vi.fn() },
    user: { findMany: vi.fn(), updateMany: vi.fn() },
    universityMerge: { create: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  }
  const prisma = { $transaction: vi.fn(async (action: (client: typeof tx) => Promise<unknown>) => action(tx)) }
  return { tx, prisma }
})

vi.mock('@/shared/db/prisma', () => ({ prisma: db.prisma }))

const repo = await import('./merge.repo')

const BASE_FIELDS = {
  name: 'Университет',
  shortName: null,
  city: 'Москва',
  region: 'Москва',
  address: null,
  website: null,
  description: null,
  directionCount: null,
  studentCount: null,
  inn: null,
  ogrn: null,
}

function university(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...BASE_FIELDS,
    id: 'target',
    status: 'ACTIVE',
    archivedAt: null,
    mergedIntoId: null,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.tx.$queryRaw.mockResolvedValue([])
  db.tx.educationalProgram.findMany.mockResolvedValue([])
  db.tx.educationalProgram.updateMany.mockResolvedValue({ count: 0 })
  db.tx.contact.findMany.mockResolvedValue([])
  db.tx.contact.updateMany.mockResolvedValue({ count: 0 })
  db.tx.contact.count.mockResolvedValue(0)
  db.tx.cooperation.findMany.mockResolvedValue([])
  db.tx.cooperation.updateMany.mockResolvedValue({ count: 0 })
  db.tx.meeting.findMany.mockResolvedValue([])
  db.tx.meeting.updateMany.mockResolvedValue({ count: 0 })
  db.tx.document.findMany.mockResolvedValue([])
  db.tx.document.updateMany.mockResolvedValue({ count: 0 })
  db.tx.application.findMany.mockResolvedValue([])
  db.tx.application.updateMany.mockResolvedValue({ count: 0 })
  db.tx.user.findMany.mockResolvedValue([])
  db.tx.user.updateMany.mockResolvedValue({ count: 0 })
})

describe('mergeUniversities: не найден', () => {
  it('источник или цель не существуют — исход not-found, ничего не переносится', async () => {
    db.tx.university.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(university())
    const outcome = await repo.mergeUniversities({
      sourceId: 's', targetId: 't', userId: 'u', rules: {}, manual: {}, now: new Date(),
    })
    expect(outcome).toEqual({ status: 'not-found', which: 'source' })
    expect(db.tx.universityMerge.create).not.toHaveBeenCalled()
  })
})

describe('mergeUniversities: перенос объектов', () => {
  it('программы, контакты, связки, встречи, документы, заявки и представителей переносит к цели', async () => {
    db.tx.university.findUnique
      .mockResolvedValueOnce(university({ id: 'source', name: 'Дубль' }))
      .mockResolvedValueOnce(university({ id: 'target' }))
    db.tx.educationalProgram.findMany.mockResolvedValue([{ id: 'p1' }])
    db.tx.contact.findMany.mockResolvedValue([{ id: 'c1' }])
    db.tx.cooperation.findMany.mockResolvedValue([{ id: 'coop1' }])
    db.tx.meeting.findMany.mockResolvedValue([{ id: 'm1' }])
    db.tx.document.findMany.mockResolvedValue([{ id: 'd1' }])
    db.tx.application.findMany.mockResolvedValue([{ id: 'a1' }])
    db.tx.user.findMany.mockResolvedValue([{ id: 'u1' }])
    db.tx.universityMerge.create.mockResolvedValue({ id: 'merge1' })

    const outcome = await repo.mergeUniversities({
      sourceId: 'source', targetId: 'target', userId: 'admin', rules: {}, manual: {}, now: new Date('2026-02-01'),
    })

    expect(outcome.status).toBe('merged')
    expect(db.tx.educationalProgram.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['p1'] } }, data: { universityId: 'target' } })
    expect(db.tx.contact.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['c1'] } }, data: { universityId: 'target' } })
    expect(db.tx.cooperation.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['coop1'] } }, data: { universityId: 'target' } })
    expect(db.tx.meeting.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['m1'] } }, data: { universityId: 'target' } })
    expect(db.tx.document.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['d1'] } }, data: { universityId: 'target' } })
    expect(db.tx.application.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['a1'] } }, data: { universityId: 'target' } })
    expect(db.tx.user.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['u1'] } }, data: { universityId: 'target' } })

    // Источник уходит в архив со ссылкой на цель — не удаляется.
    expect(db.tx.university.update).toHaveBeenCalledWith({
      where: { id: 'source' },
      data: { status: 'ARCHIVED', archivedAt: new Date('2026-02-01'), mergedIntoId: 'target' },
    })
  })

  it('основной контакт цели уже есть — основной контакт дубля становится обычным', async () => {
    db.tx.university.findUnique
      .mockResolvedValueOnce(university({ id: 'source' }))
      .mockResolvedValueOnce(university({ id: 'target' }))
    db.tx.contact.count.mockResolvedValue(1) // у цели уже есть основной контакт
    db.tx.contact.findMany
      .mockResolvedValueOnce([{ id: 'c1' }]) // все контакты источника (перенос)
      .mockResolvedValueOnce([{ id: 'c1' }]) // основной контакт источника (понижение)
    db.tx.universityMerge.create.mockResolvedValue({ id: 'merge1' })

    await repo.mergeUniversities({ sourceId: 'source', targetId: 'target', userId: 'admin', rules: {}, manual: {}, now: new Date() })

    expect(db.tx.contact.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['c1'] } }, data: { isPrimary: false } })
    const createPayload = db.tx.universityMerge.create.mock.calls[0]![0].data
    expect(createPayload.moved.demotedContacts).toEqual(['c1'])
  })

  it('журнал слияния хранит правило по каждому полю и записи о выживших значениях', async () => {
    db.tx.university.findUnique
      .mockResolvedValueOnce(university({ id: 'source', website: 'https://source.ru' }))
      .mockResolvedValueOnce(university({ id: 'target', website: null }))
    db.tx.universityMerge.create.mockResolvedValue({ id: 'merge1' })

    await repo.mergeUniversities({
      sourceId: 'source', targetId: 'target', userId: 'admin',
      rules: { website: 'non_null' }, manual: {}, now: new Date(),
    })

    const createPayload = db.tx.universityMerge.create.mock.calls[0]![0].data
    expect(createPayload.fieldRules.website).toBe('non_null')
    const websiteEntry = createPayload.survivorship.find((entry: { field: string }) => entry.field === 'website')
    expect(websiteEntry).toMatchObject({ chosen: 'source', resultValue: 'https://source.ru', changed: true })
    // Пустое значение цели заменяется значением источника прямо в записи вуза.
    expect(db.tx.university.update).toHaveBeenCalledWith({ where: { id: 'target' }, data: { website: 'https://source.ru' } })
  })

  it('вуз уже слит с другим — сообщает об этом и ничего не меняет', async () => {
    db.tx.university.findUnique
      .mockResolvedValueOnce(university({ id: 'source', mergedIntoId: 'somewhere-else' }))
      .mockResolvedValueOnce(university({ id: 'target' }))
    await expect(
      repo.mergeUniversities({ sourceId: 'source', targetId: 'target', userId: 'admin', rules: {}, manual: {}, now: new Date() }),
    ).rejects.toMatchObject({ status: 409 })
    expect(db.tx.university.update).not.toHaveBeenCalled()
  })
})

describe('undoMerge', () => {
  const mergedAt = new Date('2026-01-01T00:00:00Z')
  const baseMerge = {
    id: 'merge1',
    sourceId: 'source',
    targetId: 'target',
    mergedAt,
    undoUntil: new Date('2026-03-01T00:00:00Z'),
    undoneAt: null,
    fieldRules: { website: 'non_null' },
    survivorship: [
      { field: 'website', rule: 'non_null', chosen: 'source', changed: true, targetValue: null, sourceValue: 'https://source.ru', resultValue: 'https://source.ru' },
    ],
    moved: {
      programs: ['p1'], contacts: [], cooperations: [], meetings: [], documents: [], applications: [], users: [],
      demotedContacts: [],
    },
    before: { target: { fields: BASE_FIELDS, updatedAt: mergedAt.toISOString() }, source: { status: 'ACTIVE', archivedAt: null } },
    mergedBy: { id: 'admin', fullName: 'Админ', role: 'ADMIN' },
  }

  it('не найдено — исход not-found', async () => {
    db.tx.universityMerge.findUnique.mockResolvedValue(null)
    const outcome = await repo.undoMerge('nope', 'admin', new Date('2026-02-01'))
    expect(outcome).toEqual({ status: 'not-found' })
  })

  it('в срок — переносит объекты обратно источнику и возвращает поле цели к прежнему значению', async () => {
    db.tx.universityMerge.findUnique.mockResolvedValue({ sourceId: 'source', targetId: 'target' })
    db.tx.universityMerge.findUniqueOrThrow.mockResolvedValue(baseMerge)
    db.tx.educationalProgram.updateMany.mockResolvedValue({ count: 1 })
    db.tx.cooperation.findMany.mockResolvedValue([])
    db.tx.university.findUniqueOrThrow.mockResolvedValue(university({ id: 'target', website: 'https://source.ru' }))
    db.tx.universityMerge.update.mockResolvedValue({ ...baseMerge, undoneAt: new Date('2026-02-01'), undoneById: 'admin' })

    const outcome = await repo.undoMerge('merge1', 'admin', new Date('2026-02-01'))

    expect(outcome.status).toBe('undone')
    if (outcome.status !== 'undone') throw new Error('unreachable')
    expect(outcome.returned.programs).toBe(1)
    expect(outcome.restored).toEqual(['website'])
    // Поле цели вернулось к значению до слияния (null), потому что после слияния его не меняли.
    expect(db.tx.university.update).toHaveBeenCalledWith({ where: { id: 'target' }, data: { website: null } })
    // Источник возвращается активным, без ссылки на цель.
    expect(db.tx.university.update).toHaveBeenCalledWith({
      where: { id: 'source' },
      data: { mergedIntoId: null, status: 'ACTIVE', archivedAt: null },
    })
  })

  it('поле цели изменили после слияния — при отмене значение не трогается', async () => {
    db.tx.universityMerge.findUnique.mockResolvedValue({ sourceId: 'source', targetId: 'target' })
    db.tx.universityMerge.findUniqueOrThrow.mockResolvedValue(baseMerge)
    db.tx.cooperation.findMany.mockResolvedValue([])
    db.tx.university.findUniqueOrThrow.mockResolvedValue(university({ id: 'target', website: 'https://changed-later.ru' }))
    db.tx.universityMerge.update.mockResolvedValue(baseMerge)

    const outcome = await repo.undoMerge('merge1', 'admin', new Date('2026-02-01'))
    if (outcome.status !== 'undone') throw new Error('unreachable')
    expect(outcome.kept).toEqual(['website'])
    expect(outcome.restored).toEqual([])
    expect(db.tx.university.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'target' } }))
  })

  it('срок отмены истёк — ошибка, ничего не меняется', async () => {
    db.tx.universityMerge.findUnique.mockResolvedValue({ sourceId: 'source', targetId: 'target' })
    db.tx.universityMerge.findUniqueOrThrow.mockResolvedValue(baseMerge)
    await expect(repo.undoMerge('merge1', 'admin', new Date('2026-04-01'))).rejects.toMatchObject({ status: 409 })
    expect(db.tx.universityMerge.update).not.toHaveBeenCalled()
  })

  it('слияние уже отменено — повторная отмена невозможна', async () => {
    db.tx.universityMerge.findUnique.mockResolvedValue({ sourceId: 'source', targetId: 'target' })
    db.tx.universityMerge.findUniqueOrThrow.mockResolvedValue({ ...baseMerge, undoneAt: new Date('2026-01-15') })
    await expect(repo.undoMerge('merge1', 'admin', new Date('2026-02-01'))).rejects.toMatchObject({ status: 409 })
  })
})
