import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  EXTERNAL_SEAL_ID,
  NO_ANCHOR,
  auditCanonical,
  auditRowHash,
  canonicalTimestamp,
  checkSeal,
  createChainVerifier,
  isSealComparable,
  parseExternalSeal,
  verdictsAgree,
  type ChainAnchor,
  type ChainRow,
  type ChainVerdict,
} from './chain.rules'
import { auditVerifyPayload } from './chain.service'

/**
 * Цепочка журнала (решение 115): зеркало правил базы на TypeScript.
 * Та же проверка на настоящей базе, с подменой строк и гонкой вставок, —
 * chain.db.test.ts (нужна TEST_DATABASE_URL).
 */

/**
 * Эталон из PostgreSQL 16: audit_row_canonical(7, 'cm-row-7', NULL, 'stage.status.change',
 * 'WorkflowStage', 'st"1|x', '{"to":"COMPLETED","note":"строка\nдва","address":"203.0.113.7","n":2.50}',
 * '2026-09-25 20:16:51.691') и audit_row_hash от неё. Если тест упал после обновления
 * PostgreSQL — поменялся вывод jsonb или json_build_array, и хеши старых строк
 * перестанут сходиться: это нужно знать до обновления стенда.
 */
const GOLDEN = {
  canonical:
    '["v1", "7", "cm-row-7", null, "stage.status.change", "WorkflowStage", "st\\"1|x", ' +
    '"{\\"n\\": 2.50, \\"to\\": \\"COMPLETED\\", \\"note\\": \\"строка\\\\nдва\\"}", "2026-09-25T20:16:51.691000Z"]',
  hashFromGenesis: '8042bd869ca62d0c9e6fe1450f3a2531f345720d7085a503e2e9eb72b9aa59e9',
  hashAfterAbab: '11386ba2b8eb8a3a8dd9fd592682d168379feacb83c2fe611bc346b1114dc953',
}

const baseRow = {
  id: 'cm-row-7',
  userId: null,
  action: 'stage.status.change',
  objectType: 'WorkflowStage',
  objectId: 'st"1|x',
  // Так отдаёт база: (payload - 'address')::text — ключи jsonb упорядочены по длине.
  payloadText: '{"n": 2.50, "to": "COMPLETED", "note": "строка\\nдва"}',
  createdAtText: '2026-09-25T20:16:51.691000Z',
}

describe('каноническая запись и хеш совпадают с базой', () => {
  it('каноническая запись — как json_build_array в PostgreSQL', () => {
    expect(auditCanonical({ ...baseRow, chainSeq: 7n })).toBe(GOLDEN.canonical)
  })

  it('хеш первой строки считается от GENESIS', () => {
    expect(auditRowHash(null, GOLDEN.canonical)).toBe(GOLDEN.hashFromGenesis)
  })

  it('хеш следующей строки — от hex предыдущего хеша', () => {
    expect(auditRowHash('ab'.repeat(32), GOLDEN.canonical)).toBe(GOLDEN.hashAfterAbab)
  })

  it('время — UTC с микросекундами, как to_char(…US"Z")', () => {
    expect(canonicalTimestamp(new Date('2026-09-25T20:16:51.691Z'))).toBe('2026-09-25T20:16:51.691000Z')
    expect(canonicalTimestamp(new Date('2026-01-02T03:04:05.000Z'))).toBe('2026-01-02T03:04:05.000000Z')
  })

  it('поля не склеиваются: «a|b» + «c» и «a» + «b|c» дают разное', () => {
    const one = auditCanonical({ ...baseRow, chainSeq: 1n, action: 'a|b', objectType: 'c' })
    const two = auditCanonical({ ...baseRow, chainSeq: 1n, action: 'a', objectType: 'b|c' })
    expect(one).not.toBe(two)
  })

  it('NULL и строка «null» различаются', () => {
    expect(auditCanonical({ ...baseRow, chainSeq: 1n, userId: null })).not.toBe(
      auditCanonical({ ...baseRow, chainSeq: 1n, userId: 'null' }),
    )
  })

  it('управляющие символы экранируются как в PostgreSQL: \\u0001 строчными', () => {
    expect(auditCanonical({ ...baseRow, chainSeq: 1n, objectId: 'x\u0001y\tz' })).toContain('"x\\u0001y\\tz"')
  })
})

/** Цепочка, построенная по тем же правилам, что и триггер. */
function buildChain(count: number, anchor: ChainAnchor = NO_ANCHOR): ChainRow[] {
  const rows: ChainRow[] = []
  let prev = anchor.hash
  for (let index = 0; index < count; index += 1) {
    const chainSeq = anchor.seq + BigInt(index) + 1n
    const content = {
      ...baseRow,
      id: `row-${chainSeq}`,
      payloadText: `{"n": ${index}}`,
      createdAtText: canonicalTimestamp(new Date(Date.UTC(2026, 8, 25, 12, 0, index))),
    }
    const rowHash = auditRowHash(prev, auditCanonical({ ...content, chainSeq }))
    rows.push({ ...content, chainSeq, prevHash: prev, rowHash })
    prev = rowHash
  }
  return rows
}

function run(rows: ChainRow[], anchor: ChainAnchor = NO_ANCHOR) {
  const verifier = createChainVerifier(anchor)
  for (const row of rows) if (verifier.push(row)) break
  return { broken: verifier.broken(), state: verifier.state() }
}

describe('проверка цепочки', () => {
  it('целая цепочка проходит, голова — последняя строка', () => {
    const rows = buildChain(5)
    const { broken, state } = run(rows)
    expect(broken).toBeNull()
    expect(state).toEqual({ checked: 5, headSeq: 5n, headHash: rows[4]!.rowHash })
  })

  it('пустой журнал — цел, голова (0, null)', () => {
    expect(run([])).toEqual({ broken: null, state: { checked: 0, headSeq: 0n, headHash: null } })
  })

  it('изменённое поле — «строка изменена» на этой строке', () => {
    const rows = buildChain(5)
    rows[2] = { ...rows[2]!, action: 'user.role.change' }
    const { broken, state } = run(rows)
    expect(broken).toMatchObject({ code: 'row_modified', seq: 3n, id: 'row-3' })
    expect(state.checked).toBe(2)
  })

  it('изменённый payload и время тоже ловятся', () => {
    const payload = buildChain(3)
    payload[1] = { ...payload[1]!, payloadText: '{"n": 100}' }
    expect(run(payload).broken?.code).toBe('row_modified')

    const time = buildChain(3)
    time[1] = { ...time[1]!, createdAtText: '2020-01-01T00:00:00.000000Z' }
    expect(run(time).broken?.code).toBe('row_modified')
  })

  it('удалённая строка из середины — «удалена строка № 3»', () => {
    const rows = buildChain(5)
    rows.splice(2, 1)
    const { broken } = run(rows)
    expect(broken).toMatchObject({ code: 'rows_missing', seq: 4n })
    expect(broken?.reason).toBe('Удалена строка № 3')
  })

  it('несколько удалённых подряд называются диапазоном', () => {
    const rows = buildChain(6)
    rows.splice(1, 3)
    expect(run(rows).broken?.reason).toBe('Удалены строки № 2–4')
  })

  it('удалённая и перенумерованная строка — разрыв ссылки', () => {
    const rows = buildChain(5)
    rows.splice(2, 1)
    // Злоумышленник сдвинул номера, но хеши не пересчитал.
    const renumbered = rows.map((row, index) => ({ ...row, chainSeq: BigInt(index + 1) }))
    expect(run(renumbered).broken).toMatchObject({ code: 'link_broken', seq: 3n })
  })

  it('пересчитанный хеш строки ломает ссылку следующей', () => {
    const rows = buildChain(5)
    const forged = { ...rows[1]!, action: 'user.block' }
    forged.rowHash = auditRowHash(forged.prevHash, auditCanonical({ ...forged, chainSeq: forged.chainSeq! }))
    rows[1] = forged
    expect(run(rows).broken).toMatchObject({ code: 'link_broken', seq: 3n })
  })

  it('строка без номера — вставлена в обход триггера', () => {
    const rows = buildChain(2)
    expect(run([{ ...rows[0]!, chainSeq: null }]).broken?.code).toBe('row_unnumbered')
    expect(run([{ ...rows[0]!, rowHash: null }]).broken?.code).toBe('row_unnumbered')
  })

  it('после чистки по сроку цепочка начинается с точки чистки', () => {
    const full = buildChain(8)
    const anchor = { seq: 3n, hash: full[2]!.rowHash }
    const { broken, state } = run(full.slice(3), anchor)
    expect(broken).toBeNull()
    expect(state).toMatchObject({ checked: 5, headSeq: 8n })
  })

  it('без точки чистки удалённое начало — «удалены строки № 1–3»', () => {
    expect(run(buildChain(8).slice(3)).broken?.reason).toBe('Удалены строки № 1–3')
  })

  it('строка из вычищенной части — отдельный код', () => {
    const full = buildChain(8)
    const anchor = { seq: 3n, hash: full[2]!.rowHash }
    expect(run(full.slice(2), anchor).broken).toMatchObject({ code: 'row_before_cut', seq: 3n })
  })

  it('поддельная точка чистки не сходится с первой строкой', () => {
    const full = buildChain(8)
    expect(run(full.slice(3), { seq: 3n, hash: 'ff'.repeat(32) }).broken?.code).toBe('link_broken')
  })
})

describe('сверка с печатью', () => {
  const rows = buildChain(10)
  const head = run(rows).state
  const sealAt = (seq: number, id = 1n) => ({ id, headSeq: BigInt(seq), headHash: rows[seq - 1]!.rowHash })

  it('печать совпадает со своей строкой', () => {
    expect(checkSeal(sealAt(7), head, NO_ANCHOR, rows[6]!.rowHash)).toBeNull()
  })

  it('удалён хвост дальше печати — «удалён хвост журнала»', () => {
    const cut = run(rows.slice(0, 5)).state
    const broken = checkSeal(sealAt(7, 4n), cut, NO_ANCHOR, null)
    expect(broken).toMatchObject({ code: 'tail_removed', seq: 7n, id: null })
    expect(broken?.reason).toContain('Печать № 4 видела строку № 7, а журнал кончается на № 5')
  })

  it('хвост после последней печати цепочка и печать не видят — поэтому печать снимается часто', () => {
    const cut = run(rows.slice(0, 8)).state
    expect(checkSeal(sealAt(7), cut, NO_ANCHOR, rows[6]!.rowHash)).toBeNull()
  })

  it('пересчитанная история — «история переписана»', () => {
    expect(checkSeal(sealAt(7), head, NO_ANCHOR, 'ee'.repeat(32))?.code).toBe('history_rewritten')
  })

  it('печать в вычищенной части не сверяется, в точке чистки — сверяется с ней', () => {
    const anchor = { seq: 5n, hash: rows[4]!.rowHash }
    expect(isSealComparable(sealAt(3), anchor)).toBe(false)
    expect(isSealComparable(sealAt(5), anchor)).toBe(true)
    expect(checkSeal(sealAt(5), head, anchor, null)).toBeNull()
    expect(checkSeal({ ...sealAt(5), headHash: 'dd'.repeat(32) }, head, anchor, null)?.code).toBe('history_rewritten')
  })

  it('печать пустого журнала ничего не требует', () => {
    expect(isSealComparable({ id: 1n, headSeq: 0n, headHash: null }, NO_ANCHOR)).toBe(false)
  })

  it('печать вне базы называется так в причине', () => {
    const external = { id: EXTERNAL_SEAL_ID, headSeq: 7n, headHash: 'ee'.repeat(32) }
    expect(checkSeal(external, head, NO_ANCHOR, rows[6]!.rowHash)?.reason).toContain('печатью вне базы')
  })
})

describe('печать вне базы из командной строки', () => {
  it('разбирает номер и хеш', () => {
    expect(parseExternalSeal('12', 'ab'.repeat(32))).toEqual({ id: 0n, headSeq: 12n, headHash: 'ab'.repeat(32) })
    expect(parseExternalSeal(undefined, undefined)).toBeNull()
    expect(parseExternalSeal('0', undefined)).toEqual({ id: 0n, headSeq: 0n, headHash: null })
  })

  it('кривой ввод — ошибка, а не молчаливое «цело»', () => {
    expect(() => parseExternalSeal('12', undefined)).toThrow()
    expect(() => parseExternalSeal(undefined, 'ab'.repeat(32))).toThrow()
    expect(() => parseExternalSeal('-1', 'ab'.repeat(32))).toThrow()
    expect(() => parseExternalSeal('12', 'AB'.repeat(32))).toThrow()
    expect(() => parseExternalSeal('12', 'ab')).toThrow()
  })
})

describe('итоги двух проверок', () => {
  const verdict: ChainVerdict = {
    ok: true,
    checked: 10,
    code: null,
    brokenSeq: null,
    brokenId: null,
    reason: null,
    headSeq: 10n,
    headHash: 'aa'.repeat(32),
    anchorSeq: 0n,
    sealsChecked: 2,
  }

  it('совпадают — согласие; текст причины не сравнивается', () => {
    expect(verdictsAgree(verdict, { ...verdict })).toBe(true)
  })

  it('любое расхождение по сути — несогласие', () => {
    expect(verdictsAgree(verdict, { ...verdict, headHash: 'bb'.repeat(32) })).toBe(false)
    expect(verdictsAgree(verdict, { ...verdict, checked: 9 })).toBe(false)
    expect(verdictsAgree(verdict, { ...verdict, ok: false, code: 'row_modified' })).toBe(false)
  })

  it('в журнал о проверке — итог и номера, без хешей', () => {
    const payload = auditVerifyPayload({ ...verdict, ok: false, code: 'rows_missing', brokenSeq: 4n }, 'api')
    expect(payload).toEqual({ source: 'api', ok: false, checked: 10, headSeq: 10, code: 'rows_missing', brokenAt: 4 })
    expect(JSON.stringify(auditVerifyPayload(verdict, 'script'))).not.toContain('aa'.repeat(32))
  })
})

describe('установка цепочки в миграции', () => {
  const migrations = readdirSync(join(process.cwd(), 'prisma/migrations'))
    .filter((name) => !name.endsWith('.toml'))
    .map((name) => readFileSync(join(process.cwd(), 'prisma/migrations', name, 'migration.sql'), 'utf8'))
    .join('\n')

  it('тот же канон, что и здесь: версия v1, адрес клиента вне хеша, время с микросекундами', () => {
    expect(migrations).toContain("'v1',")
    expect(migrations).toContain("(p_payload - 'address')::text")
    expect(migrations).toContain(`to_char(p_created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`)
    expect(migrations).toContain("coalesce(encode(p_prev_hash, 'hex'), 'GENESIS') || '|' || p_canonical")
  })

  it('чистку журнала и установку триггеров роль приложения вызвать не может', () => {
    expect(migrations).toContain('REVOKE EXECUTE ON FUNCTION audit_purge_before(timestamp, boolean, text) FROM PUBLIC')
    expect(migrations).toContain('REVOKE EXECUTE ON FUNCTION audit_chain_install(text) FROM PUBLIC')
  })
})
