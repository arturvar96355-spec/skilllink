import { afterEach, describe, expect, it, vi } from 'vitest'
import { dsarOperator } from './dsar.config'

/**
 * Реквизиты оператора ПД для выгрузки «всё о субъекте» (решение 116, закрыто
 * решением 139): раньше это был `TODO: PM DECISION` и `null` в ответе, теперь —
 * переменные окружения с понятной заглушкой по умолчанию.
 */
describe('dsarOperator', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('без переменных окружения — заглушка одна на все три поля', () => {
    vi.stubEnv('OPERATOR_NAME', '')
    vi.stubEnv('OPERATOR_ADDRESS', '')
    vi.stubEnv('OPERATOR_CONTACT', '')
    const operator = dsarOperator()
    const PLACEHOLDER = 'ИТ-Школа РТК (реквизиты указываются при внедрении)'
    expect(operator.name).toBe(PLACEHOLDER)
    expect(operator.address).toBe(PLACEHOLDER)
    expect(operator.responsibleContact).toBe(PLACEHOLDER)
  })

  it('заданные переменные подставляются как есть, с обрезкой пробелов', () => {
    vi.stubEnv('OPERATOR_NAME', '  ИТ-Школа РТК  ')
    vi.stubEnv('OPERATOR_ADDRESS', '350000, г. Ростов-на-Дону, ул. Примерная, 1')
    vi.stubEnv('OPERATOR_CONTACT', 'dpo@example.invalid')
    const operator = dsarOperator()
    expect(operator.name).toBe('ИТ-Школа РТК')
    expect(operator.address).toBe('350000, г. Ростов-на-Дону, ул. Примерная, 1')
    expect(operator.responsibleContact).toBe('dpo@example.invalid')
  })

  it('поля независимы: заданное имя не подставляет заглушку в адрес и контакт', () => {
    vi.stubEnv('OPERATOR_NAME', 'ИТ-Школа РТК')
    vi.stubEnv('OPERATOR_ADDRESS', '')
    vi.stubEnv('OPERATOR_CONTACT', '')
    const operator = dsarOperator()
    expect(operator.name).toBe('ИТ-Школа РТК')
    expect(operator.address).toBe('ИТ-Школа РТК (реквизиты указываются при внедрении)')
    expect(operator.responsibleContact).toBe('ИТ-Школа РТК (реквизиты указываются при внедрении)')
  })

  it('сведения о работниках оператора в примечании не обещаются', () => {
    expect(dsarOperator().note).toContain('152-ФЗ')
  })
})
