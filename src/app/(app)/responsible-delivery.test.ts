import { describe, expect, it } from 'vitest'
import { deliveryNotice } from './responsible-delivery'

describe('окно «Сменить ответственного»: куда уйдёт уведомление (решение 210)', () => {
  it('подключён мессенджер — называет его', () => {
    expect(deliveryNotice({ messenger: 'telegram' })).toBe('Уведомление придёт в колокольчик SkillLink и в Telegram.')
  })

  it('не подключён — прямо говорит, что только колокольчик', () => {
    expect(deliveryNotice({ messenger: null })).toContain('не подключён')
  })

  it('сервер поля не прислал или сотрудник не выбран — строки нет', () => {
    expect(deliveryNotice({})).toBeNull()
    expect(deliveryNotice(undefined)).toBeNull()
  })
})
