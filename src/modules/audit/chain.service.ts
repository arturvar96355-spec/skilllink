import { prisma } from '@/shared/db/prisma'
import type { PrismaClient } from '@/generated/prisma/client'
import { writeAudit } from '@/shared/audit/audit'
import { assertCan } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { PageMeta } from '@/shared/contracts/common'
import type { AuditChainVerifyDto, AuditSealDto } from '@/shared/contracts/audit'
import { pageMeta, toSkipTake, type Pagination } from '@/shared/http/pagination'
import * as repo from './chain.repo'
import {
  NO_ANCHOR,
  checkSeal,
  createChainVerifier,
  isSealComparable,
  verdictsAgree,
  type ChainBreak,
  type ChainBreakCode,
  type ChainVerdict,
  type SealRef,
} from './chain.rules'

/**
 * Журнал действий с защитой от подмены (решение 115).
 *
 * Проверка идёт двумя независимыми путями в одном снимке базы: функцией
 * audit_verify_chain() в самой базе и кодом приложения (chain.rules.ts) по строкам,
 * прочитанным встроенными средствами. Пройдена — только если оба «да» и итоги совпали.
 */

/** Сколько строк журнала читается за раз при проверке в приложении. */
const BATCH = 5000

/** Проверка большого журнала — не мгновенная: предел транзакции с запасом. */
const VERIFY_TIMEOUT_MS = 120_000

export interface ChainReport extends ChainVerdict {
  lastSeal: repo.SealRecord | null
  verifiedAt: Date
}

export interface VerifyOptions {
  /** Схема с таблицами журнала; не `public` — только в тесте цепочки. */
  schema?: string
  /** Печать, хранящаяся вне базы (из сообщения владельцу): сверяется дополнительно. */
  externalSeal?: SealRef
}

/** Проверка на стороне приложения — зеркало audit_verify_chain(). */
async function applicationVerdict(
  tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
  schema: string,
  seals: repo.SealRecord[],
): Promise<ChainVerdict> {
  const anchor = (await repo.loadAnchor(tx, schema)) ?? NO_ANCHOR
  const verifier = createChainVerifier(anchor)
  const verdict = (broken: ChainBreak | null, sealsChecked: number): ChainVerdict => {
    const state = verifier.state()
    return {
      ok: broken === null,
      checked: state.checked,
      code: broken?.code ?? null,
      brokenSeq: broken?.seq ?? null,
      brokenId: broken?.id ?? null,
      reason: broken?.reason ?? null,
      headSeq: state.headSeq,
      headHash: state.headHash,
      anchorSeq: anchor.seq,
      sealsChecked,
    }
  }

  const unnumbered = await repo.findUnnumbered(tx, schema)
  if (unnumbered) return verdict(verifier.push(unnumbered), 0)

  // Хеши строк, на которые указывают печати, запоминаются по ходу — без отдельных запросов.
  const wanted = new Set(seals.map((seal) => seal.headSeq))
  const hashAt = new Map<bigint, string | null>()
  let after: bigint | null = null
  for (;;) {
    const rows = await repo.loadChainBatch(tx, after, BATCH, schema)
    for (const row of rows) {
      const broken = verifier.push(row)
      if (broken) return verdict(broken, 0)
      if (wanted.has(row.chainSeq!)) hashAt.set(row.chainSeq!, row.rowHash)
    }
    if (rows.length < BATCH) break
    after = rows.at(-1)!.chainSeq
  }

  let sealsChecked = 0
  for (const seal of seals) {
    if (!isSealComparable(seal, anchor)) continue
    const broken = checkSeal(seal, verifier.state(), anchor, hashAt.get(seal.headSeq) ?? null)
    if (broken) return verdict(broken, sealsChecked)
    sealsChecked += 1
  }
  return verdict(null, sealsChecked)
}

function sqlVerdictOf(row: repo.SqlVerdictRow): ChainVerdict {
  return {
    ok: row.ok,
    checked: Number(row.checked),
    code: row.code as ChainBreakCode | null,
    brokenSeq: row.broken_seq,
    brokenId: row.broken_id,
    reason: row.reason,
    headSeq: row.head_seq,
    headHash: row.head_hash,
    anchorSeq: row.anchor_seq,
    sealsChecked: Number(row.seals_checked),
  }
}

const summary = (verdict: ChainVerdict): string =>
  verdict.ok
    ? `цепочка цела, строк ${verdict.checked}, голова № ${verdict.headSeq}`
    : `${verdict.code} на № ${verdict.brokenSeq ?? '—'}`

/**
 * Проверить цепочку журнала. Ничего не пишет: всё — в одной транзакции
 * REPEATABLE READ READ ONLY, так что обе проверки видят один и тот же журнал,
 * даже если в него пишут прямо сейчас.
 */
export async function verifyChain(client: PrismaClient = prisma, options: VerifyOptions = {}): Promise<ChainReport> {
  const schema = options.schema ?? 'public'
  const { app, db, seals } = await client.$transaction(
    async (tx) => {
      await repo.setReadOnly(tx)
      // Печати читаются до строк: печать, снятая во время проверки, не должна
      // указать на строку, которой проверка ещё не видела.
      const seals = await repo.loadSeals(tx, schema)
      const db = sqlVerdictOf(await repo.sqlVerdict(tx, schema))
      const app = await applicationVerdict(tx, schema, seals)
      return { app, db, seals }
    },
    { isolationLevel: 'RepeatableRead', timeout: VERIFY_TIMEOUT_MS, maxWait: 10_000 },
  )

  let result: ChainVerdict = app
  if (!verdictsAgree(app, db)) {
    result = {
      ...app,
      ok: false,
      code: 'engines_disagree',
      reason:
        `Проверка в базе и проверка в приложении разошлись (база: ${summary(db)}; ` +
        `приложение: ${summary(app)}). Функцию проверки в базе могли подменить.`,
    }
  }

  if (result.ok && options.externalSeal) {
    const broken = checkSeal(
      options.externalSeal,
      { checked: result.checked, headSeq: result.headSeq, headHash: result.headHash },
      (await repo.loadAnchor(client, schema)) ?? NO_ANCHOR,
      await hashAtSeq(client, schema, options.externalSeal.headSeq),
    )
    if (broken) {
      result = { ...result, ok: false, code: broken.code, brokenSeq: broken.seq, brokenId: null, reason: broken.reason }
    }
  }

  return { ...result, lastSeal: seals.at(-1) ?? null, verifiedAt: new Date() }
}

/** row_hash строки с номером `seq` (null — такой строки нет). */
async function hashAtSeq(client: PrismaClient, schema: string, seq: bigint): Promise<string | null> {
  const rows = await repo.loadChainBatch(client, seq - 1n, 1, schema)
  return rows[0]?.chainSeq === seq ? rows[0].rowHash : null
}

/** Печать в том виде, в каком её отдают API и `npm run audit:seal`. */
export function toSealDto(seal: repo.SealRecord): AuditSealDto {
  return {
    id: seal.id.toString(),
    headSeq: Number(seal.headSeq),
    headHash: seal.headHash,
    count: Number(seal.rowCount),
    at: seal.createdAt.toISOString(),
  }
}

export function toVerifyDto(report: ChainReport): AuditChainVerifyDto {
  return {
    ok: report.ok,
    checked: report.checked,
    code: report.code,
    brokenAt: report.brokenSeq === null ? null : Number(report.brokenSeq),
    brokenId: report.brokenId,
    reason: report.reason,
    headSeq: Number(report.headSeq),
    headHash: report.headHash,
    anchorSeq: Number(report.anchorSeq),
    sealsChecked: report.sealsChecked,
    lastSeal: report.lastSeal ? toSealDto(report.lastSeal) : null,
    verifiedAt: report.verifiedAt.toISOString(),
  }
}

/**
 * Снять печать журнала: `{ headSeq, headHash, count, at }` и номер печати.
 *
 * Печать сохраняется в audit_seals, но смысл у неё появляется, только когда её копия
 * лежит вне базы (сообщение владельцу): удаливший хвост журнала удалит и печать
 * из базы, а сообщение — нет. Вызывается по расписанию (`npm run audit:seal`).
 */
export async function auditSeal(client: PrismaClient = prisma, schema = 'public'): Promise<AuditSealDto> {
  return toSealDto(await repo.takeSeal(client, schema))
}

/**
 * `GET /api/audit/verify`: проверка по кнопке администратора. Сам факт проверки
 * и её итог пишутся в журнал — после проверки, поэтому эта запись уже в следующей.
 */
export async function verifyChainForAdmin(user: CurrentUser): Promise<AuditChainVerifyDto> {
  assertCan(user, 'ADMIN')
  const report = await verifyChain()
  await writeAudit({
    userId: user.id,
    action: 'audit.verify',
    objectType: 'AuditLog',
    objectId: 'chain',
    payload: auditVerifyPayload(report, 'api'),
  })
  return toVerifyDto(report)
}

/** Что пишется в журнал о проверке: итог и номера — без хешей и содержимого строк. */
export function auditVerifyPayload(report: ChainVerdict, source: 'api' | 'script') {
  return {
    source,
    ok: report.ok,
    checked: report.checked,
    headSeq: Number(report.headSeq),
    ...(report.ok ? {} : { code: report.code, brokenAt: report.brokenSeq === null ? null : Number(report.brokenSeq) }),
  }
}

/** `GET /api/audit/seals`: печати журнала, новые сверху. */
export async function listSealsForAdmin(
  user: CurrentUser,
  query: Pagination,
): Promise<{ data: AuditSealDto[]; meta: PageMeta }> {
  assertCan(user, 'ADMIN')
  const { skip, take } = toSkipTake(query)
  const { rows, total } = await repo.listSeals(skip, take)
  return { data: rows.map(toSealDto), meta: pageMeta(query, total) }
}
