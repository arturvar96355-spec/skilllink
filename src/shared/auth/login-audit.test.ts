import { describe, expect, it } from 'vitest'
import { UNKNOWN_ACCOUNT, loginAuditEntries } from './login-audit'

describe('журнал входа', () => {
  it('удачный вход — кто и с какого адреса', () => {
    expect(loginAuditEntries({ kind: 'success', userId: 'u1', address: '203.0.113.10' })).toEqual([
      {
        userId: 'u1',
        action: 'auth.login.success',
        objectType: 'User',
        objectId: 'u1',
        payload: { address: '203.0.113.10' },
      },
    ])
  })

  it('неудача по неизвестной учётной записи не хранит введённую почту', () => {
    const [entry] = loginAuditEntries({
      kind: 'failure',
      userId: null,
      address: '198.51.100.7',
      triggered: [],
    })
    expect(entry).toMatchObject({
      userId: null,
      action: 'auth.login.failure',
      objectId: UNKNOWN_ACCOUNT,
      payload: { address: '198.51.100.7', knownAccount: false },
    })
    expect(JSON.stringify(entry)).not.toContain('@')
  })

  it('блокировка пишется отдельной записью в момент, когда наступила', () => {
    const entries = loginAuditEntries({
      kind: 'failure',
      userId: 'u1',
      address: '198.51.100.7',
      triggered: ['account-address'],
    })
    expect(entries.map((entry) => entry.action)).toEqual(['auth.login.failure', 'auth.login.blocked'])
    expect(entries[1]?.payload).toEqual({ address: '198.51.100.7', counters: ['account-address'] })
  })
})
