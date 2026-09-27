import { describe, expect, it } from 'vitest'
import type { ApprovalDto } from '@/shared/contracts'
import {
  approvalRequiredAction,
  approvalStep,
  approvalTabOf,
  approvalTitle,
  approvalTone,
  approvalValue,
  decisionText,
  executionBody,
  findOwnRequest,
  timeLeftText,
} from './approvals-view'

const NOW = Date.parse('2026-09-28T10:00:00.000Z')
const HOUR = 3600_000

function item(overrides: Partial<ApprovalDto> = {}): ApprovalDto {
  return {
    id: 'ap-1',
    action: 'user.grant_admin',
    payload: { userId: 'u-target' },
    status: 'REQUESTED',
    requestedBy: { id: 'u-bob', fullName: 'Соловьёва Марина Дмитриевна', role: 'ADMIN' },
    approvedBy: null,
    rejectedBy: null,
    createdAt: new Date(NOW - HOUR).toISOString(),
    decidedAt: null,
    expiresAt: new Date(NOW + 20 * HOUR).toISOString(),
    consumedAt: null,
    canApprove: true,
    target: { id: 'u-target', fullName: 'Орлов Михаил Юрьевич', role: 'ANALYST', isActive: true },
    reason: null,
    rejectReason: null,
    ...overrides,
  }
}

const me = { id: 'u-alice', isReviewer: false }

describe('строка запроса', () => {
  it('заголовок — что и над кем, коротким ФИО', () => {
    expect(approvalTitle(item())).toBe('Назначить администратором: Орлов М. Ю.')
    expect(approvalTitle(item({ action: 'user.block_admin', target: null }))).toBe(
      'Заблокировать администратора: пользователь удалён',
    )
  })

  it('остаток срока словами', () => {
    expect(timeLeftText(new Date(NOW + 20 * HOUR).toISOString(), NOW)).toBe('ещё 20 ч')
    expect(timeLeftText(new Date(NOW + 25 * 60_000).toISOString(), NOW)).toBe('ещё 25 мин')
    expect(timeLeftText(new Date(NOW + 72 * HOUR).toISOString(), NOW)).toBe('ещё 3 дня')
    expect(timeLeftText(new Date(NOW - 1).toISOString(), NOW)).toBe('срок вышел')
  })

  it('тон: фиолетовый — ждёт, красный — срок почти вышел, бледный — решено', () => {
    expect(approvalTone(item(), NOW)).toBe('accent')
    expect(approvalTone(item({ expiresAt: new Date(NOW + HOUR).toISOString() }), NOW)).toBe('critical')
    expect(approvalTone(item({ status: 'REJECTED' }), NOW)).toBe('accent-faint')
    expect(approvalValue(item({ expiresAt: new Date(NOW + HOUR).toISOString() }), NOW).tone).toBe('danger')
    expect(approvalValue(item({ status: 'CONSUMED' }), NOW)).toEqual({ text: 'выполнено', tone: 'muted' })
    // Ждал, но срок вышел, а список ещё не перечитан — показываем как истёкший.
    expect(approvalValue(item({ expiresAt: new Date(NOW - 1).toISOString() }), NOW).text).toBe('истёк срок')
  })

  it('кто решил', () => {
    expect(decisionText(item({ status: 'APPROVED', approvedBy: { id: 'x', fullName: 'Демидова Анна Сергеевна', role: 'ADMIN' } }))).toBe(
      'Согласовано: Демидова А. С.',
    )
    expect(decisionText(item({ status: 'EXPIRED' }))).toBe('Никто не решил до конца срока')
    expect(decisionText(item())).toBeNull()
  })
})

describe('следующий шаг и права', () => {
  it('чужой ждущий — согласовать; свой ждущий — только отозвать', () => {
    expect(approvalStep(item(), me, NOW)).toBe('approve')
    const mine = item({ requestedBy: { id: me.id, fullName: 'Я', role: 'ADMIN' }, canApprove: false })
    expect(approvalStep(mine, me, NOW)).toBe('withdraw')
  })

  it('свой согласованный — выполнить; чужой согласованный — ничего', () => {
    const approved = item({ status: 'APPROVED', canApprove: false })
    expect(approvalStep({ ...approved, requestedBy: { id: me.id, fullName: 'Я', role: 'ADMIN' } }, me, NOW)).toBe('run')
    expect(approvalStep(approved, me, NOW)).toBeNull()
  })

  it('эксперт, истёкший и решённый — без действий', () => {
    expect(approvalStep(item(), { ...me, isReviewer: true }, NOW)).toBeNull()
    expect(approvalStep(item({ expiresAt: new Date(NOW - 1).toISOString() }), me, NOW)).toBeNull()
    expect(approvalStep(item({ status: 'REJECTED', canApprove: false }), me, NOW)).toBeNull()
  })

  it('вкладка запроса для перехода из колокольчика', () => {
    expect(approvalTabOf(item(), me.id, NOW)).toBe('awaiting')
    expect(approvalTabOf(item({ requestedBy: { id: me.id, fullName: 'Я', role: 'ADMIN' } }), me.id, NOW)).toBe('mine')
    expect(approvalTabOf(item({ status: 'REJECTED' }), me.id, NOW)).toBe('history')
  })
})

describe('выполнение и ответ 403', () => {
  it('тело выполнения — та же операция и approvalId', () => {
    expect(executionBody('user.grant_admin', 'ap-1')).toEqual({ role: 'ADMIN', approvalId: 'ap-1' })
    expect(executionBody('user.block_admin', 'ap-2')).toEqual({ isActive: false, approvalId: 'ap-2' })
  })

  it('признак «нужно второе подтверждение» — только из details сервера', () => {
    expect(approvalRequiredAction({ approvalRequired: true, action: 'user.block_admin' })).toBe('user.block_admin')
    expect(approvalRequiredAction({ approvalRequired: false, action: 'user.block_admin' })).toBeNull()
    expect(approvalRequiredAction([{ field: 'role', message: '…' }])).toBeNull()
    expect(approvalRequiredAction(undefined)).toBeNull()
  })

  it('свой живой запрос на ту же операцию находится — дубль не нужен', () => {
    const own = item({ requestedBy: { id: me.id, fullName: 'Я', role: 'ADMIN' } })
    expect(findOwnRequest([own], 'user.grant_admin', 'u-target', me.id, NOW)?.id).toBe('ap-1')
    expect(findOwnRequest([own], 'user.block_admin', 'u-target', me.id, NOW)).toBeNull()
    expect(findOwnRequest([{ ...own, status: 'REJECTED' }], 'user.grant_admin', 'u-target', me.id, NOW)).toBeNull()
    expect(findOwnRequest([item()], 'user.grant_admin', 'u-target', me.id, NOW)).toBeNull()
  })
})
