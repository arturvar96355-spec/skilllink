import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/shared/http/errors'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { UserRole } from '@/shared/contracts/enums'
import {
  ANONYMIZED_CONTACT_FIELDS,
  ANONYMIZED_CONTACT_NAME,
  isAnonymizedContact,
} from './universities.rules'

/**
 * Обезличивание контакта вуза (право субъекта на удаление ПД, docs/PRIVACY.md).
 *
 * База подменяется: проверяется то, что решает сервис, — кто вправе, что стирается,
 * что попадает в журнал и что повтор ничего не делает.
 */
const repo = vi.hoisted(() => ({
  findContact: vi.fn(),
  updateContact: vi.fn(),
}))
const audit = vi.hoisted(() => ({ writeAudit: vi.fn() }))

vi.mock('./universities.repo', () => repo)
vi.mock('@/shared/audit/audit', () => audit)

const { anonymizeContact } = await import('./universities.service')

function user(role: UserRole): CurrentUser {
  return {
    id: `u-${role}`,
    email: `${role.toLowerCase()}@example.invalid`,
    fullName: 'Тестовый Пользователь',
    role,
    universityId: role === 'UNIVERSITY_REP' ? 'uni-1' : null,
  }
}

const LIVE = {
  id: 'c-1',
  universityId: 'uni-1',
  fullName: 'Ветрова Ирина Павловна',
  position: 'Заместитель декана',
  email: 'vetrova@example.invalid',
  phone: '+7 900 000-00-00',
  isPrimary: true,
}

const ANONYMIZED = {
  ...LIVE,
  fullName: ANONYMIZED_CONTACT_NAME,
  position: null,
  email: null,
  phone: null,
  isPrimary: false,
}

beforeEach(() => {
  repo.findContact.mockReset()
  repo.updateContact.mockReset()
  audit.writeAudit.mockReset()
})

describe('правило обезличивания контакта', () => {
  it('стирает ФИО, должность, почту, телефон, заметки и снимает признак основного', () => {
    expect(ANONYMIZED_CONTACT_FIELDS).toEqual({
      fullName: 'Контакт удалён',
      position: null,
      email: null,
      phone: null,
      notes: null,
      isPrimary: false,
    })
  })

  it('живой контакт — не обезличен, стёртый — обезличен', () => {
    expect(isAnonymizedContact(LIVE)).toBe(false)
    expect(isAnonymizedContact(ANONYMIZED)).toBe(true)
  })

  it('однофамилец «Контакт удалён» с почтой обезличенным не считается', () => {
    expect(isAnonymizedContact({ ...ANONYMIZED, email: 'x@example.invalid' })).toBe(false)
  })
})

describe('POST /api/universities/:id/contacts/:contactId/anonymize', () => {
  it.each(['MANAGER', 'ANALYST', 'VIEWER', 'UNIVERSITY_REP'] as const)(
    'роль %s — отказ, база не трогается',
    async (role) => {
      await expect(anonymizeContact(user(role), 'uni-1', 'c-1')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
      expect(repo.findContact).not.toHaveBeenCalled()
      expect(repo.updateContact).not.toHaveBeenCalled()
    },
  )

  it('контакт другого вуза — NOT_FOUND', async () => {
    repo.findContact.mockResolvedValue(null)
    const promise = anonymizeContact(user('ADMIN'), 'uni-2', 'c-1')
    await expect(promise).rejects.toBeInstanceOf(AppError)
    await expect(promise).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(repo.findContact).toHaveBeenCalledWith('uni-2', 'c-1')
    expect(repo.updateContact).not.toHaveBeenCalled()
  })

  it('администратор обезличивает: запись остаётся, данные стёрты', async () => {
    repo.findContact.mockResolvedValue(LIVE)
    repo.updateContact.mockResolvedValue(ANONYMIZED)

    const result = await anonymizeContact(user('ADMIN'), 'uni-1', 'c-1')

    expect(repo.updateContact).toHaveBeenCalledWith('c-1', ANONYMIZED_CONTACT_FIELDS)
    expect(result).toMatchObject({
      id: 'c-1',
      fullName: 'Контакт удалён',
      email: null,
      phone: null,
      position: null,
      isPrimary: false,
      isAnonymized: true,
    })
  })

  it('в журнал — факт без персональных данных', async () => {
    repo.findContact.mockResolvedValue(LIVE)
    repo.updateContact.mockResolvedValue(ANONYMIZED)

    await anonymizeContact(user('ADMIN'), 'uni-1', 'c-1')

    expect(audit.writeAudit).toHaveBeenCalledTimes(1)
    const entry = audit.writeAudit.mock.calls[0]?.[0]
    expect(entry).toMatchObject({
      userId: 'u-ADMIN',
      action: 'contact.anonymize',
      objectType: 'Contact',
      objectId: 'c-1',
    })
    const serialized = JSON.stringify(entry)
    for (const value of [LIVE.fullName, LIVE.email, LIVE.phone, LIVE.position]) {
      expect(serialized).not.toContain(value)
    }
  })

  it('повтор ничего не меняет и журнал не засоряет', async () => {
    repo.findContact.mockResolvedValue(ANONYMIZED)

    const result = await anonymizeContact(user('ADMIN'), 'uni-1', 'c-1')

    expect(result.isAnonymized).toBe(true)
    expect(repo.updateContact).not.toHaveBeenCalled()
    expect(audit.writeAudit).not.toHaveBeenCalled()
  })
})
