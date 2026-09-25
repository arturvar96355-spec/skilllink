import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import { auditCanonical, auditRowHash, type SealRef } from './chain.rules'
import * as repo from './chain.repo'
import { auditSeal, verifyChain } from './chain.service'

/**
 * Цепочка журнала на настоящей PostgreSQL (решение 115): триггер, запрет правки,
 * подмена строк, удаление середины и хвоста, чистка по сроку, гонка вставок.
 *
 * Нужна база с применёнными миграциями — адрес в TEST_DATABASE_URL (в CI — та же база,
 * что у сквозного сценария). Без неё набор пропускается: `npm test` базы не требует.
 *
 * Настоящий журнал не трогается: тест создаёт временную схему с копией таблиц журнала,
 * ставит на неё триггеры той же функцией audit_chain_install(), что и миграция,
 * и удаляет схему в конце. Нужно право CREATE на базу (владелец или суперпользователь).
 */

const url = process.env.TEST_DATABASE_URL
const SCHEMA = `audit_chain_test_${process.pid}_${Date.now().toString(36)}`

describe.skipIf(!url)('цепочка журнала на настоящей базе', () => {
  let db: PrismaClient
  let rowNumber = 0

  /** Обход запрета правки журнала — так, как это делают чистка по сроку и злоумышленник-владелец. */
  const bypass = async (sql: string) => {
    await db.$transaction([
      db.$executeRaw`SELECT set_config('skilllink.allow_audit_purge', 'on', true)`,
      db.$executeRawUnsafe(sql),
    ])
  }

  const insert = async (options: { payload?: unknown; createdAt?: string; action?: string } = {}) => {
    rowNumber += 1
    await db.$executeRawUnsafe(
      `INSERT INTO ${SCHEMA}.audit_log (id, user_id, action, object_type, object_id, payload, created_at)
       VALUES ($1, NULL, $2, 'AuditLog', $3, $4::jsonb, $5::timestamp)`,
      `row-${rowNumber}`,
      options.action ?? 'audit.verify',
      `object-${rowNumber}`,
      options.payload === undefined ? null : JSON.stringify(options.payload),
      options.createdAt ?? new Date().toISOString(),
    )
  }

  const insertMany = async (count: number) => {
    for (let index = 0; index < count; index += 1) await insert({ payload: { n: index } })
  }

  const verify = (externalSeal?: SealRef) =>
    verifyChain(db, { schema: SCHEMA, externalSeal })

  const seqs = async () =>
    (
      await db.$queryRawUnsafe<Array<{ chain_seq: bigint }>>(
        `SELECT chain_seq FROM ${SCHEMA}.audit_log ORDER BY chain_seq`,
      )
    ).map((row) => Number(row.chain_seq))

  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url!, max: 25 }) })
    await db.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`)
    for (const table of ['audit_log', 'audit_seals', 'audit_chain_cuts']) {
      // INCLUDING ALL — с CHECK, уникальными индексами и умолчаниями; внешних ключей LIKE не копирует.
      await db.$executeRawUnsafe(`CREATE TABLE ${SCHEMA}.${table} (LIKE public.${table} INCLUDING ALL)`)
    }
    // Свои последовательности номеров, чтобы не расходовать номера настоящих таблиц.
    for (const table of ['audit_seals', 'audit_chain_cuts']) {
      await db.$executeRawUnsafe(`CREATE SEQUENCE ${SCHEMA}.${table}_id_seq OWNED BY ${SCHEMA}.${table}.id`)
      await db.$executeRawUnsafe(
        `ALTER TABLE ${SCHEMA}.${table} ALTER COLUMN id SET DEFAULT nextval('${SCHEMA}.${table}_id_seq')`,
      )
    }
    await db.$executeRawUnsafe(`SELECT public.audit_chain_install('${SCHEMA}')`)
  })

  afterAll(async () => {
    if (!db) return
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
    await db.$disconnect()
  })

  beforeEach(async () => {
    await bypass(`TRUNCATE ${SCHEMA}.audit_log, ${SCHEMA}.audit_seals, ${SCHEMA}.audit_chain_cuts`)
  })

  it('триггер строит цепочку, обе проверки согласны: цела', async () => {
    await insert({ payload: { note: 'кавычка " и черта \\ и перевод\nстроки', n: 2.5, list: [1, 'два'] } })
    await insert({ payload: null })
    await insert({ payload: ['массив', 1] })
    await insert({ payload: 'строка' })
    await insert({ payload: { address: '203.0.113.7', ok: true }, action: 'auth.login.success' })

    const report = await verify()
    expect(report).toMatchObject({ ok: true, checked: 5, headSeq: 5n, anchorSeq: 0n, code: null })
    expect(await seqs()).toEqual([1, 2, 3, 4, 5])

    // Зеркало на TypeScript считает те же хеши, что и триггер, — строка за строкой.
    const rows = await repo.loadChainBatch(db, null, 100, SCHEMA)
    let prev: string | null = null
    for (const row of rows) {
      expect(row.prevHash).toBe(prev)
      expect(auditRowHash(prev, auditCanonical({ ...row, chainSeq: row.chainSeq! }))).toBe(row.rowHash)
      prev = row.rowHash
    }
  })

  it('значения цепочки из INSERT перезаписываются триггером', async () => {
    await insertMany(2)
    await db.$executeRawUnsafe(
      `INSERT INTO ${SCHEMA}.audit_log (id, action, object_type, object_id, created_at, chain_seq, prev_hash, row_hash)
       VALUES ('forged', 'user.block', 'User', 'u', now(), 1000, NULL, '\\x00')`,
    )
    expect(await seqs()).toEqual([1, 2, 3])
    expect((await verify()).ok).toBe(true)
  })

  it('UPDATE, DELETE и TRUNCATE без обхода запрещены — и у журнала, и у печатей', async () => {
    await insertMany(2)
    await auditSeal(db, SCHEMA)
    await expect(db.$executeRawUnsafe(`UPDATE ${SCHEMA}.audit_log SET action = 'x'`)).rejects.toThrow(/только дописывается/)
    await expect(db.$executeRawUnsafe(`DELETE FROM ${SCHEMA}.audit_log`)).rejects.toThrow(/только дописывается/)
    await expect(db.$executeRawUnsafe(`TRUNCATE ${SCHEMA}.audit_log`)).rejects.toThrow(/только дописывается/)
    await expect(db.$executeRawUnsafe(`DELETE FROM ${SCHEMA}.audit_seals`)).rejects.toThrow(/только дописывается/)
    await expect(db.$executeRawUnsafe(`UPDATE ${SCHEMA}.audit_seals SET row_count = 0`)).rejects.toThrow(/только дописывается/)
    // TRUNCATE ловится и на пустой таблице: триггер на оператор, а не на строку.
    await expect(db.$executeRawUnsafe(`TRUNCATE ${SCHEMA}.audit_chain_cuts`)).rejects.toThrow(/только дописывается/)
    expect((await verify()).checked).toBe(2)
  })

  it('стёртый по сроку адрес клиента цепочку не ломает', async () => {
    await insert({ payload: { address: '203.0.113.7', knownAccount: true } })
    await insertMany(2)
    await bypass(`UPDATE ${SCHEMA}.audit_log SET payload = payload || '{"address": null}' WHERE chain_seq = 1`)
    expect((await verify()).ok).toBe(true)
  })

  it('изменённая строка — «строка изменена»', async () => {
    await insertMany(5)
    await bypass(`UPDATE ${SCHEMA}.audit_log SET action = 'user.role.change' WHERE chain_seq = 3`)
    const report = await verify()
    expect(report).toMatchObject({ ok: false, code: 'row_modified', brokenSeq: 3n, brokenId: 'row-' + (rowNumber - 2), checked: 2 })
  })

  it('изменённая строка с отключённым триггером — то же', async () => {
    await insertMany(4)
    await db.$transaction([
      db.$executeRawUnsafe(`ALTER TABLE ${SCHEMA}.audit_log DISABLE TRIGGER audit_log_append_only`),
      db.$executeRawUnsafe(`UPDATE ${SCHEMA}.audit_log SET payload = '{"n": 99}' WHERE chain_seq = 2`),
      db.$executeRawUnsafe(`ALTER TABLE ${SCHEMA}.audit_log ENABLE TRIGGER audit_log_append_only`),
    ])
    expect(await verify()).toMatchObject({ ok: false, code: 'row_modified', brokenSeq: 2n })
  })

  it('удалённая строка из середины — «удалена строка № 3»', async () => {
    await insertMany(5)
    await bypass(`DELETE FROM ${SCHEMA}.audit_log WHERE chain_seq = 3`)
    const report = await verify()
    expect(report).toMatchObject({ ok: false, code: 'rows_missing', brokenSeq: 4n, reason: 'Удалена строка № 3' })
  })

  it('пересчитанная после правки история ловится только печатью', async () => {
    await insertMany(3)
    await auditSeal(db, SCHEMA)
    await insertMany(2)
    // Владелец базы правит строку 2 и честно пересчитывает хеши от неё до головы.
    await bypass(`
      DO $$
      DECLARE r record; v_prev bytea; v_hash bytea;
      BEGIN
        UPDATE ${SCHEMA}.audit_log SET action = 'user.unblock' WHERE chain_seq = 2;
        SELECT row_hash INTO v_prev FROM ${SCHEMA}.audit_log WHERE chain_seq = 1;
        FOR r IN SELECT * FROM ${SCHEMA}.audit_log WHERE chain_seq >= 2 ORDER BY chain_seq LOOP
          v_hash := public.audit_row_hash(v_prev, public.audit_row_canonical(r.chain_seq, r.id, r.user_id, r.action,
                      r.object_type, r.object_id, r.payload, r.created_at));
          UPDATE ${SCHEMA}.audit_log SET prev_hash = v_prev, row_hash = v_hash WHERE id = r.id;
          v_prev := v_hash;
        END LOOP;
      END $$`)
    const report = await verify()
    expect(report).toMatchObject({ ok: false, code: 'history_rewritten', brokenSeq: 3n, checked: 5 })
  })

  it('удалённый хвост ловится сверкой с печатью', async () => {
    await insertMany(5)
    const seal = await auditSeal(db, SCHEMA)
    expect(seal).toMatchObject({ headSeq: 5, count: 5 })
    await insertMany(2)
    await bypass(`DELETE FROM ${SCHEMA}.audit_log WHERE chain_seq >= 4`)

    const report = await verify()
    expect(report).toMatchObject({ ok: false, code: 'tail_removed', brokenSeq: 5n, headSeq: 3n })
    expect(report.reason).toContain('журнал кончается на № 3')
  })

  it('печати удалены из базы вместе с хвостом — ловит печать вне базы', async () => {
    await insertMany(5)
    const seal = await auditSeal(db, SCHEMA)
    await bypass(`DELETE FROM ${SCHEMA}.audit_log WHERE chain_seq >= 4`)
    await bypass(`DELETE FROM ${SCHEMA}.audit_seals`)

    expect((await verify()).ok).toBe(true)
    const external = { id: 0n, headSeq: BigInt(seal.headSeq), headHash: seal.headHash }
    expect(await verify(external)).toMatchObject({ ok: false, code: 'tail_removed' })
  })

  it('хвост после последней печати не виден — ограничение, ради которого печать снимается часто', async () => {
    await insertMany(3)
    await auditSeal(db, SCHEMA)
    await insertMany(2)
    await bypass(`DELETE FROM ${SCHEMA}.audit_log WHERE chain_seq >= 4`)
    expect((await verify()).ok).toBe(true)
  })

  it('чистка по сроку удаляет начало цепочки и записывает точку чистки', async () => {
    await insert({ createdAt: '2020-01-01T00:00:00.000Z' })
    await insert({ createdAt: '2020-01-02T00:00:00.000Z' })
    const early = await auditSeal(db, SCHEMA)
    await insert({ createdAt: '2020-01-03T00:00:00.000Z' })
    await insert({ createdAt: '2026-01-01T00:00:00.000Z' })
    // Долгая транзакция: запись старше срока встала в цепочку после свежей.
    await insert({ createdAt: '2020-01-04T00:00:00.000Z' })
    await insert({ createdAt: '2026-01-02T00:00:00.000Z' })

    const [plan] = await db.$queryRawUnsafe<Array<{ cut_seq: bigint; deleted: bigint; older_kept: bigint }>>(
      `SELECT * FROM public.audit_purge_before('2025-01-01', false, '${SCHEMA}')`,
    )
    expect(plan).toEqual({ cut_seq: 3n, deleted: 3n, older_kept: 1n })
    expect(await seqs()).toHaveLength(6)

    const [done] = await db.$queryRawUnsafe<Array<{ cut_seq: bigint; deleted: bigint }>>(
      `SELECT * FROM public.audit_purge_before('2025-01-01', true, '${SCHEMA}')`,
    )
    expect(done).toMatchObject({ cut_seq: 3n, deleted: 3n })
    expect(await seqs()).toEqual([4, 5, 6])

    const report = await verify()
    expect(report).toMatchObject({ ok: true, checked: 3, anchorSeq: 3n, headSeq: 6n })
    // Печать № 2 указывает в вычищенную часть — сверять не с чем, это не нарушение.
    expect(early.headSeq).toBe(2)
    expect(report.sealsChecked).toBe(0)

    await insert()
    expect(await seqs()).toEqual([4, 5, 6, 7])
    expect((await verify()).ok).toBe(true)
  })

  it('чистка не удаляет голову: следующей записи нужен её хеш', async () => {
    await insert({ createdAt: '2020-01-01T00:00:00.000Z' })
    await insert({ createdAt: '2020-01-02T00:00:00.000Z' })
    await db.$queryRawUnsafe(`SELECT * FROM public.audit_purge_before('2025-01-01', true, '${SCHEMA}')`)
    expect(await seqs()).toEqual([2])
    await insert()
    expect(await verify()).toMatchObject({ ok: true, anchorSeq: 1n, headSeq: 3n })
  })

  it('удалённое начало без точки чистки — «удалены строки»', async () => {
    await insertMany(4)
    await bypass(`DELETE FROM ${SCHEMA}.audit_log WHERE chain_seq <= 2`)
    expect(await verify()).toMatchObject({ ok: false, code: 'rows_missing', reason: 'Удалены строки № 1–2' })
  })

  it('гонка: 20 параллельных вставок — цепочка цела, номера без дыр', async () => {
    await insertMany(1)
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        db.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe(
              `INSERT INTO ${SCHEMA}.audit_log (id, action, object_type, object_id, payload, created_at)
               VALUES ($1, 'audit.verify', 'AuditLog', 'race', $2::jsonb, now() AT TIME ZONE 'UTC')`,
              `race-${index}`,
              JSON.stringify({ index }),
            )
            // Транзакция держит блокировку цепочки — остальные ждут, а не ветвят цепочку.
            await tx.$executeRawUnsafe('SELECT pg_sleep(0.01)')
          },
          { timeout: 30_000, maxWait: 30_000 },
        ),
      ),
    )
    expect(await seqs()).toEqual(Array.from({ length: 21 }, (_, index) => index + 1))
    expect(await verify()).toMatchObject({ ok: true, checked: 21, headSeq: 21n })
  })

  it('печать — голова и число строк под блокировкой цепочки', async () => {
    await insertMany(3)
    const seal = await auditSeal(db, SCHEMA)
    const report = await verify()
    expect(seal).toMatchObject({ headSeq: 3, count: 3, headHash: report.headHash })
    expect(new Date(seal.at).getTime()).toBeGreaterThan(Date.now() - 60_000)
    expect(report).toMatchObject({ ok: true, sealsChecked: 1 })
    expect(report.lastSeal?.id).toBe(BigInt(seal.id))
  })
})
