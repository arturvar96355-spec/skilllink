import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Приём данных извне (решение 145, POST /api/import/external). Решение 190,
 * ревью базы: `repo.createLink` (ключ идемпотентности повторной загрузки) писался
 * ПОСЛЕ `$transaction`, что создавала связку — сбой между ними (обрыв соединения,
 * падение процесса) оставлял связку без ключа, и повторный запрос с тем же
 * (source, externalId) не находил её и заводил вторую такую же. Здесь проверяется,
 * что `createLink` вызывается внутри той же транзакции — с тем же клиентом (`tx`),
 * что и создание связки, а не с прямым доступом к базе.
 */

const TX = { marker: 'tx' }

const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
}))

const repo = vi.hoisted(() => ({
  findUniversityByInn: vi.fn(async () => null),
  findUniversityByName: vi.fn(async () => null),
  createUniversity: vi.fn(async () => ({ id: 'univ-1' })),
  findProgramByCode: vi.fn(async () => null),
  findProgramByName: vi.fn(async () => null),
  createProgram: vi.fn(async () => ({ id: 'prog-1' })),
  findProductByName: vi.fn(async () => null),
  createProduct: vi.fn(async () => ({ id: 'prod-1' })),
  findResponsibleByEmails: vi.fn(async () => ({ id: 'user-1', email: 'manager@example.invalid' })),
  findLink: vi.fn(async (): Promise<{ id: string; cooperationId: string } | null> => null),
  createLink: vi.fn(async () => undefined),
  findCooperationRef: vi.fn(),
  updateCooperationLink: vi.fn(),
}))

const cooperationRepo = vi.hoisted(() => ({
  lockProgram: vi.fn(async () => undefined),
  findOpenDuplicate: vi.fn(async (): Promise<{ id: string } | null> => null),
  createWithStages: vi.fn(async () => 'coop-1'),
}))

const audit = vi.hoisted(() => ({ writeAudit: vi.fn() }))

vi.mock('@/shared/db/prisma', () => ({ prisma: db }))
vi.mock('./external.repo', () => repo)
vi.mock('@/modules/cooperation/cooperation.repo', () => cooperationRepo)
vi.mock('@/shared/audit/audit', () => audit)

const { importExternal } = await import('./external.service')

const INPUT = {
  source: 'site' as const,
  externalId: 'ext-1',
  university: { name: 'Университет Тест', inn: null, city: null, region: null },
  program: { code: null, name: 'Программа Тест' },
  product: { name: 'Продукт Тест' },
  responsibleEmails: ['manager@example.invalid'],
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.findUniversityByInn.mockResolvedValue(null)
  repo.findUniversityByName.mockResolvedValue(null)
  repo.createUniversity.mockResolvedValue({ id: 'univ-1' })
  repo.findProgramByCode.mockResolvedValue(null)
  repo.findProgramByName.mockResolvedValue(null)
  repo.createProgram.mockResolvedValue({ id: 'prog-1' })
  repo.findProductByName.mockResolvedValue(null)
  repo.createProduct.mockResolvedValue({ id: 'prod-1' })
  repo.findResponsibleByEmails.mockResolvedValue({ id: 'user-1', email: 'manager@example.invalid' })
  repo.findLink.mockResolvedValue(null)
  cooperationRepo.lockProgram.mockResolvedValue(undefined)
  cooperationRepo.findOpenDuplicate.mockResolvedValue(null)
  cooperationRepo.createWithStages.mockResolvedValue('coop-1')
  db.$transaction.mockImplementation(async (action: (tx: typeof TX) => Promise<unknown>) => action(TX))
})

describe('importExternal — новая связка', () => {
  it('пишет ключ идемпотентности (createLink) внутри той же транзакции, что создаёт связку', async () => {
    const callOrder: string[] = []
    cooperationRepo.createWithStages.mockImplementation(async () => {
      callOrder.push('createWithStages')
      return 'coop-1'
    })
    repo.createLink.mockImplementation(async () => {
      callOrder.push('createLink')
    })

    const result = await importExternal(INPUT)

    expect(db.$transaction).toHaveBeenCalledTimes(1)
    // createLink получает клиент транзакции (tx), а не глобальный prisma напрямую.
    expect(repo.createLink).toHaveBeenCalledWith('site', 'ext-1', 'coop-1', TX)
    // Порядок внутри транзакции: сначала связка, потом ключ — обе операции успевают
    // до коммита или не происходят вовсе.
    expect(callOrder).toEqual(['createWithStages', 'createLink'])
    expect(result.cooperation).toEqual({ id: 'coop-1', outcome: 'created' })
  })

  it('если сбой внутри транзакции — createLink не остаётся висеть отдельно', async () => {
    db.$transaction.mockImplementation(async (action: (tx: typeof TX) => Promise<unknown>) => {
      try {
        return await action(TX)
      } catch (error) {
        throw error
      }
    })
    cooperationRepo.createWithStages.mockResolvedValue('coop-1')
    repo.createLink.mockRejectedValueOnce(new Error('сбой соединения'))

    await expect(importExternal(INPUT)).rejects.toThrow('сбой соединения')
    // createLink упал внутри той же транзакции, что и создание связки — оба вызова
    // случились в одной попытке, а не так, что связка уже «в базе», а ключа нет.
    expect(cooperationRepo.createWithStages).toHaveBeenCalledTimes(1)
    expect(repo.createLink).toHaveBeenCalledTimes(1)
    expect(audit.writeAudit).not.toHaveBeenCalled()
  })
})

describe('importExternal — уже есть открытая связка без ключа (дубль)', () => {
  it('пишет ключ идемпотентности для найденной связки внутри той же транзакции', async () => {
    cooperationRepo.findOpenDuplicate.mockResolvedValue({ id: 'coop-existing' })

    const result = await importExternal(INPUT)

    expect(cooperationRepo.createWithStages).not.toHaveBeenCalled()
    expect(repo.createLink).toHaveBeenCalledWith('site', 'ext-1', 'coop-existing', TX)
    expect(result.cooperation).toEqual({ id: 'coop-existing', outcome: 'created' })
  })
})

describe('importExternal — повторный запрос по существующему ключу', () => {
  it('не открывает транзакцию заново — обновляет связку по найденному ключу', async () => {
    repo.findLink.mockResolvedValue({ id: 'link-1', cooperationId: 'coop-old' })

    const result = await importExternal(INPUT)

    expect(db.$transaction).not.toHaveBeenCalled()
    expect(repo.createLink).not.toHaveBeenCalled()
    expect(repo.updateCooperationLink).toHaveBeenCalledWith('coop-old', {
      productId: 'prod-1',
      responsibleId: 'user-1',
    })
    expect(result.cooperation).toEqual({ id: 'coop-old', outcome: 'updated' })
  })
})
