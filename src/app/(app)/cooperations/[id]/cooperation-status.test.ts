import { describe, expect, it } from 'vitest'
import { cooperationStatusConsequence, isClosedCooperationStatus } from './cooperation-status'

describe('isClosedCooperationStatus', () => {
  it('COMPLETED и CANCELLED — закрытые статусы', () => {
    expect(isClosedCooperationStatus('COMPLETED')).toBe(true)
    expect(isClosedCooperationStatus('CANCELLED')).toBe(true)
  })

  it('DRAFT, ACTIVE, PAUSED — открытые статусы', () => {
    expect(isClosedCooperationStatus('DRAFT')).toBe(false)
    expect(isClosedCooperationStatus('ACTIVE')).toBe(false)
    expect(isClosedCooperationStatus('PAUSED')).toBe(false)
  })
})

describe('cooperationStatusConsequence', () => {
  it('переход в закрытый статус предупреждает о заморозке этапов', () => {
    expect(cooperationStatusConsequence('ACTIVE', 'COMPLETED')).toMatch(/закроется/)
    expect(cooperationStatusConsequence('ACTIVE', 'CANCELLED')).toMatch(/закроется/)
  })

  it('переоткрытие из закрытого статуса сообщает о возврате в работу', () => {
    expect(cooperationStatusConsequence('COMPLETED', 'ACTIVE')).toMatch(/вернётся в работу/)
    expect(cooperationStatusConsequence('CANCELLED', 'DRAFT')).toMatch(/вернётся в работу/)
  })

  it('переход между открытыми статусами — нейтральный текст про журнал', () => {
    expect(cooperationStatusConsequence('DRAFT', 'ACTIVE')).toBe('Смена статуса попадёт в журнал действий.')
    expect(cooperationStatusConsequence('ACTIVE', 'PAUSED')).toBe('Смена статуса попадёт в журнал действий.')
  })
})
