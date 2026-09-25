import { createHash } from 'node:crypto'
import type { AuditChainBreakCode } from '@/shared/contracts/audit'

/**
 * Цепочка хешей журнала действий (решение 115) — независимая проверка на стороне приложения.
 *
 * Хеши считает триггер в базе (миграция audit_hash_chain), и там же есть функция
 * проверки audit_verify_chain(). Здесь — те же правила, написанные заново на TypeScript:
 * владелец базы может заменить функцию проверки на «всегда да», а этот код он с сервера
 * базы не подменит. Проверка считается пройденной, только когда обе стороны согласны
 * (chain.service.ts). Приём тот же, что у ключа названия навыка (решение 110): код
 * и база считают одно и то же, и расхождение само по себе — находка.
 *
 * Чистые функции: строки приходят уже прочитанными, без обращения к базе.
 */

/** Версия канонической записи — первый элемент массива. */
export const CANONICAL_VERSION = 'v1'

/** Что стоит вместо хеша предыдущей строки у первой строки цепочки. */
export const GENESIS = 'GENESIS'

/** Ключ `payload`, который в хеш не входит: адрес клиента стирается по сроку (решение 88). */
export const UNHASHED_PAYLOAD_KEY = 'address'

/**
 * Строка журнала так, как её видит проверка.
 *
 * `payloadText` и `createdAtText` база отдаёт уже в каноническом виде встроенными
 * средствами (`(payload - 'address')::text`, `to_char`): так на TypeScript не
 * приходится повторять формат вывода jsonb — а встроенные функции владелец базы
 * без прав суперпользователя подменить не может.
 */
export interface ChainRow {
  chainSeq: bigint | null
  id: string
  userId: string | null
  action: string
  objectType: string
  objectId: string
  /** jsonb::text без адреса клиента; null — payload пуст. */
  payloadText: string | null
  /** Время записи в UTC с микросекундами: `2026-09-25T20:16:51.691000Z`. */
  createdAtText: string
  /** Хеши — в шестнадцатеричном виде, 64 знака. */
  prevHash: string | null
  rowHash: string | null
}

/** Время записи в том виде, в каком его отдаёт `to_char(created_at, …US"Z")`. */
export function canonicalTimestamp(date: Date): string {
  // Колонка хранит миллисекунды (timestamp(3)), микросекунды всегда нули.
  return date.toISOString().replace(/\.(\d{3})Z$/, '.$1000Z')
}

/**
 * Каноническая запись строки — ровно то, что строит `json_build_array(...)::text`
 * в PostgreSQL: элементы через «, », строки в JSON-кавычках, NULL — `null`.
 * Экранирование у JSON.stringify и у PostgreSQL одинаковое (кавычка, обратная черта,
 * управляющие символы — \n, \t, \u0001), кириллица и прочий Юникод не экранируются.
 */
export function auditCanonical(row: Omit<ChainRow, 'prevHash' | 'rowHash'> & { chainSeq: bigint }): string {
  const items = [
    CANONICAL_VERSION,
    row.chainSeq.toString(),
    row.id,
    row.userId,
    row.action,
    row.objectType,
    row.objectId,
    row.payloadText,
    row.createdAtText,
  ]
  return `[${items.map((item) => (item === null ? 'null' : JSON.stringify(item))).join(', ')}]`
}

/** SHA-256 от хеша предыдущей строки (или GENESIS) и канонической записи, hex. */
export function auditRowHash(prevHash: string | null, canonical: string): string {
  return createHash('sha256').update(`${prevHash ?? GENESIS}|${canonical}`, 'utf8').digest('hex')
}

/** Коды нарушений — те же, что возвращает audit_verify_chain(). Список — в контракте. */
export type ChainBreakCode = AuditChainBreakCode

export interface ChainBreak {
  code: ChainBreakCode
  /** chain_seq строки, на которой найдено нарушение (у печати — строка печати). */
  seq: bigint | null
  /** id строки журнала; у нарушений по печати — null. */
  id: string | null
  reason: string
}

/** Откуда цепочка законно начинается: последняя точка чистки по сроку или (0, null). */
export interface ChainAnchor {
  seq: bigint
  hash: string | null
}

export const NO_ANCHOR: ChainAnchor = { seq: 0n, hash: null }

export interface ChainState {
  checked: number
  headSeq: bigint
  headHash: string | null
}

/**
 * Проверка цепочки по одной строке за раз — строки можно читать пачками
 * в порядке chain_seq. Первое нарушение останавливает проверку.
 */
export function createChainVerifier(anchor: ChainAnchor) {
  let expected = anchor.seq + 1n
  let prev = anchor.hash
  let checked = 0
  let headSeq = anchor.seq
  let headHash = anchor.hash
  let broken: ChainBreak | null = null

  function inspect(row: ChainRow): ChainBreak | null {
    const at = (code: ChainBreakCode, reason: string): ChainBreak => ({ code, seq: row.chainSeq, id: row.id, reason })

    if (row.chainSeq === null || row.rowHash === null) {
      return at('row_unnumbered', 'Строка без номера или хеша цепочки: вставлена в обход триггера')
    }
    if (row.chainSeq < expected) {
      return at('row_before_cut', `Строка № ${row.chainSeq} — из части журнала, вычищенной по сроку (до № ${anchor.seq})`)
    }
    if (row.chainSeq > expected) {
      return at(
        'rows_missing',
        row.chainSeq === expected + 1n
          ? `Удалена строка № ${expected}`
          : `Удалены строки № ${expected}–${row.chainSeq - 1n}`,
      )
    }
    if (row.prevHash !== prev) {
      return at(
        'link_broken',
        `Строка № ${row.chainSeq} не ссылается на предыдущую: строка перед ней удалена, переставлена или пересчитана`,
      )
    }
    const hash = auditRowHash(row.prevHash, auditCanonical({ ...row, chainSeq: row.chainSeq }))
    if (hash !== row.rowHash) return at('row_modified', `Строка № ${row.chainSeq} изменена после записи`)
    return null
  }

  return {
    /** Следующая строка по порядку chain_seq. Возвращает нарушение или null. */
    push(row: ChainRow): ChainBreak | null {
      if (broken) return broken
      broken = inspect(row)
      if (broken) return broken
      checked += 1
      expected = row.chainSeq! + 1n
      prev = row.rowHash
      headSeq = row.chainSeq!
      headHash = row.rowHash
      return null
    },
    broken: (): ChainBreak | null => broken,
    state: (): ChainState => ({ checked, headSeq, headHash }),
  }
}

export interface SealRef {
  /** Номер печати в audit_seals; EXTERNAL_SEAL_ID — печать, хранящаяся вне базы. */
  id: bigint
  headSeq: bigint
  headHash: string | null
}

/** Номер, под которым идёт печать вне базы (`--expect-seq`/`--expect-hash`). */
export const EXTERNAL_SEAL_ID = 0n

const sealName = (seal: SealRef) =>
  seal.id === EXTERNAL_SEAL_ID
    ? { nominative: 'Печать вне базы', instrumental: 'печатью вне базы' }
    : { nominative: `Печать № ${seal.id}`, instrumental: `печатью № ${seal.id}` }

/**
 * Сверка с печатью: печать новее точки чистки должна найти свою строку с тем же хешем.
 * `hashAtSeal` — row_hash строки с номером печати в нынешнем журнале (null — такой нет).
 * Печать, указывающая в вычищенную часть, не сверяется: сверять не с чем.
 */
export function checkSeal(
  seal: SealRef,
  head: ChainState,
  anchor: ChainAnchor,
  hashAtSeal: string | null,
): ChainBreak | null {
  const at = (code: ChainBreakCode, reason: string): ChainBreak => ({ code, seq: seal.headSeq, id: null, reason })
  const name = sealName(seal)

  if (seal.headSeq > head.headSeq) {
    return at(
      'tail_removed',
      `${name.nominative} видела строку № ${seal.headSeq}, а журнал кончается на № ${head.headSeq}: удалён хвост журнала`,
    )
  }
  if (seal.headSeq > anchor.seq) {
    if (hashAtSeal !== seal.headHash) {
      return at(
        'history_rewritten',
        `Хеш строки № ${seal.headSeq} не совпадает с ${name.instrumental}: история журнала переписана`,
      )
    }
    return null
  }
  if (seal.headSeq === anchor.seq && anchor.seq > 0n && seal.headHash !== anchor.hash) {
    return at(
      'history_rewritten',
      `Точка чистки № ${anchor.seq} не совпадает с ${name.instrumental}: история журнала переписана`,
    )
  }
  return null
}

/** Печать сверяется, если указывает не в вычищенную часть (или ровно в точку чистки). */
export function isSealComparable(seal: SealRef, anchor: ChainAnchor): boolean {
  return seal.headSeq > anchor.seq || (seal.headSeq === anchor.seq && anchor.seq > 0n)
}

/** Итог одной стороны проверки — так же выглядит строка audit_verify_chain(). */
export interface ChainVerdict {
  ok: boolean
  checked: number
  code: ChainBreakCode | null
  brokenSeq: bigint | null
  brokenId: string | null
  reason: string | null
  headSeq: bigint
  headHash: string | null
  anchorSeq: bigint
  sealsChecked: number
}

/**
 * Совпадают ли итоги базы и приложения. Сравнивается всё, кроме текста причины:
 * одна и та же находка должна давать тот же код, ту же строку и ту же голову.
 */
export function verdictsAgree(a: ChainVerdict, b: ChainVerdict): boolean {
  return (
    a.ok === b.ok &&
    a.checked === b.checked &&
    a.code === b.code &&
    a.brokenSeq === b.brokenSeq &&
    a.brokenId === b.brokenId &&
    a.headSeq === b.headSeq &&
    a.headHash === b.headHash &&
    a.anchorSeq === b.anchorSeq &&
    a.sealsChecked === b.sealsChecked
  )
}

/** Разбор `--expect-seq N --expect-hash H` — печать, хранящаяся вне базы. */
export function parseExternalSeal(seq: string | undefined, hash: string | undefined): SealRef | null {
  if (seq === undefined && hash === undefined) return null
  if (seq === undefined || !/^\d+$/.test(seq)) {
    throw new Error('--expect-seq — номер строки печати, целое число')
  }
  const headSeq = BigInt(seq)
  if (headSeq === 0n) {
    if (hash !== undefined) throw new Error('У пустой цепочки (--expect-seq 0) хеша нет')
    return { id: EXTERNAL_SEAL_ID, headSeq, headHash: null }
  }
  if (hash === undefined || !/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error('--expect-hash — хеш строки печати: 64 шестнадцатеричных знака в нижнем регистре')
  }
  return { id: EXTERNAL_SEAL_ID, headSeq, headHash: hash }
}
