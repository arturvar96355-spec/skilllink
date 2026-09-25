import { prisma } from '@/shared/db/prisma'
import { Prisma, type PrismaClient } from '@/generated/prisma/client'
import type { ChainAnchor, ChainRow, SealRef } from './chain.rules'

/**
 * Доступ к цепочке журнала (решение 115). Запросы — сырой SQL: функции цепочки
 * живут в миграции, а строки для независимой проверки нужны в каноническом виде,
 * который отдаёт сама база (chain.rules.ts, ChainRow).
 *
 * `schema` — схема с таблицами журнала: `public`, а в тесте цепочки — временная.
 */

type Client = Prisma.TransactionClient | PrismaClient

/** Имя схемы попадает в текст запроса — только простые идентификаторы. */
function schemaIdent(schema: string): Prisma.Sql {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error(`Недопустимое имя схемы журнала: ${schema}`)
  return Prisma.raw(`"${schema}"`)
}

/** Проверка ничего не пишет — и транзакция это гарантирует. Первой командой транзакции. */
export async function setReadOnly(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
}

/** Итог audit_verify_chain() — проверки в базе. */
export interface SqlVerdictRow {
  ok: boolean
  checked: bigint
  code: string | null
  broken_seq: bigint | null
  broken_id: string | null
  reason: string | null
  head_seq: bigint
  head_hash: string | null
  anchor_seq: bigint
  seals_checked: bigint
}

export async function sqlVerdict(client: Client, schema = 'public'): Promise<SqlVerdictRow> {
  const [row] = await client.$queryRaw<SqlVerdictRow[]>`SELECT * FROM public.audit_verify_chain(${schema})`
  if (!row) throw new Error('audit_verify_chain() не вернула итог')
  return row
}

export async function loadAnchor(client: Client, schema = 'public'): Promise<ChainAnchor | null> {
  const s = schemaIdent(schema)
  const [row] = await client.$queryRaw<Array<{ cut_seq: bigint; cut_hash: string }>>`
    SELECT cut_seq, encode(cut_hash, 'hex') AS cut_hash
      FROM ${s}.audit_chain_cuts ORDER BY cut_seq DESC LIMIT 1`
  return row ? { seq: row.cut_seq, hash: row.cut_hash } : null
}

interface SealRow {
  id: bigint
  head_seq: bigint
  head_hash: string | null
  row_count: bigint
  created_at: Date
}

export interface SealRecord extends SealRef {
  rowCount: bigint
  createdAt: Date
}

const toSeal = (row: SealRow): SealRecord => ({
  id: row.id,
  headSeq: row.head_seq,
  headHash: row.head_hash,
  rowCount: row.row_count,
  createdAt: row.created_at,
})

/** Все печати по порядку снятия — их немного (одна в сутки). */
export async function loadSeals(client: Client, schema = 'public'): Promise<SealRecord[]> {
  const s = schemaIdent(schema)
  const rows = await client.$queryRaw<SealRow[]>`
    SELECT id, head_seq, encode(head_hash, 'hex') AS head_hash, row_count, created_at
      FROM ${s}.audit_seals ORDER BY id`
  return rows.map(toSeal)
}

interface ChainRowRaw {
  chain_seq: bigint | null
  id: string
  user_id: string | null
  action: string
  object_type: string
  object_id: string
  payload_text: string | null
  created_at_text: string
  prev_hash: string | null
  row_hash: string | null
}

const toChainRow = (row: ChainRowRaw): ChainRow => ({
  chainSeq: row.chain_seq,
  id: row.id,
  userId: row.user_id,
  action: row.action,
  objectType: row.object_type,
  objectId: row.object_id,
  payloadText: row.payload_text,
  createdAtText: row.created_at_text,
  prevHash: row.prev_hash,
  rowHash: row.row_hash,
})

/**
 * Поля строки для независимой проверки. Только встроенные функции и операторы
 * PostgreSQL — ни одной функции из миграции: их владелец базы может переписать.
 */
const CHAIN_COLUMNS = Prisma.sql`
  chain_seq, id, user_id, action, object_type, object_id,
  CASE WHEN jsonb_typeof(payload) = 'object' THEN (payload - 'address')::text ELSE payload::text END AS payload_text,
  to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_text,
  encode(prev_hash, 'hex') AS prev_hash,
  encode(row_hash, 'hex') AS row_hash`

/** Первая строка без номера или хеша — такую CHECK не пропустит, но проверка не полагается на CHECK. */
export async function findUnnumbered(client: Client, schema = 'public'): Promise<ChainRow | null> {
  const s = schemaIdent(schema)
  const [row] = await client.$queryRaw<ChainRowRaw[]>`
    SELECT ${CHAIN_COLUMNS} FROM ${s}.audit_log
     WHERE chain_seq IS NULL OR row_hash IS NULL ORDER BY chain_seq NULLS FIRST LIMIT 1`
  return row ? toChainRow(row) : null
}

/** Следующая пачка строк цепочки после `afterSeq` (null — с начала). */
export async function loadChainBatch(
  client: Client,
  afterSeq: bigint | null,
  limit: number,
  schema = 'public',
): Promise<ChainRow[]> {
  const s = schemaIdent(schema)
  const rows = await client.$queryRaw<ChainRowRaw[]>`
    SELECT ${CHAIN_COLUMNS} FROM ${s}.audit_log
     WHERE chain_seq IS NOT NULL ${afterSeq === null ? Prisma.empty : Prisma.sql`AND chain_seq > ${afterSeq}`}
     ORDER BY chain_seq LIMIT ${limit}`
  return rows.map(toChainRow)
}

/** Снять печать: audit_take_seal() под блокировкой цепочки. */
export async function takeSeal(client: Client, schema = 'public'): Promise<SealRecord> {
  const [row] = await client.$queryRaw<SealRow[]>`
    SELECT id, head_seq, encode(head_hash, 'hex') AS head_hash, row_count, created_at
      FROM public.audit_take_seal(${schema})`
  if (!row) throw new Error('audit_take_seal() не вернула печать')
  return toSeal(row)
}

/** Печати для администратора — новые сверху. */
export async function listSeals(skip: number, take: number): Promise<{ rows: SealRecord[]; total: number }> {
  const [rows, total] = await Promise.all([
    prisma.auditSeal.findMany({ orderBy: { id: 'desc' }, skip, take }),
    prisma.auditSeal.count(),
  ])
  return {
    rows: rows.map((row) => ({
      id: row.id,
      headSeq: row.headSeq,
      headHash: row.headHash ? Buffer.from(row.headHash).toString('hex') : null,
      rowCount: row.rowCount,
      createdAt: row.createdAt,
    })),
    total,
  }
}
