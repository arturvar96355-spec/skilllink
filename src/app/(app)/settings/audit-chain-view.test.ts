import { describe, expect, it } from 'vitest'
import type { AuditChainVerifyDto } from '@/shared/contracts'
import { describeChainVerify } from './audit-chain-view'

/** Итог проверки целостности журнала (кнопка «Проверить целостность», решение 115/181). */

function verify(overrides: Partial<AuditChainVerifyDto> = {}): AuditChainVerifyDto {
  return {
    ok: true,
    checked: 0,
    code: null,
    brokenAt: null,
    brokenId: null,
    reason: null,
    headSeq: 0,
    headHash: null,
    anchorSeq: 0,
    sealsChecked: 0,
    lastSeal: null,
    verifiedAt: '2026-09-26T12:00:00.000Z',
    ...overrides,
  }
}

describe('describeChainVerify', () => {
  it('пустой журнал — отдельная фраза, а не «0 записей»', () => {
    expect(describeChainVerify(verify({ ok: true, checked: 0 }))).toBe('Журнал пуст — проверять нечего.')
  })

  it('цепочка цела — число записей со склонением', () => {
    expect(describeChainVerify(verify({ ok: true, checked: 1 }))).toBe('Цепочка цела: 1 запись проверено.')
    expect(describeChainVerify(verify({ ok: true, checked: 3 }))).toBe('Цепочка цела: 3 записи проверено.')
    expect(describeChainVerify(verify({ ok: true, checked: 25 }))).toBe('Цепочка цела: 25 записей проверено.')
  })

  it('нарушение — код словами, номер записи и причина от сервера', () => {
    const result = verify({
      ok: false,
      checked: 41,
      code: 'row_modified',
      brokenAt: 42,
      brokenId: 'log-42',
      reason: 'Хеш записи не совпадает с содержимым.',
    })
    expect(describeChainVerify(result)).toBe(
      'Цепочка нарушена на записи №42: Запись изменена. Хеш записи не совпадает с содержимым.',
    )
  })

  it('нарушение без номера строки (например, по печати) — без «на записи»', () => {
    const result = verify({ ok: false, checked: 10, code: 'history_rewritten', brokenAt: null, reason: 'Печать не сходится.' })
    expect(describeChainVerify(result)).toBe('Цепочка нарушена: История переписана. Печать не сходится.')
  })

  it('код не опознан фронтом — не падает, а честно об этом пишет', () => {
    const result = { ...verify({ ok: false, checked: 5 }), code: 'unknown_code' } as unknown as AuditChainVerifyDto
    expect(describeChainVerify(result)).toBe('Цепочка нарушена: нарушение не опознано.')
  })
})
