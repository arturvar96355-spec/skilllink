import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { UserRole } from '@/shared/contracts/enums'
import {
  ANONYMIZED_CONTACT_FIELDS,
  ANONYMIZED_CONTACT_NAME,
  basisHistoryKind,
  isAnonymizedContact,
  planBasisChange,
  planConsentWithdrawal,
  type ContactBasisPlan,
  type ContactForBasis,
} from './universities.rules'

/**
 * Учёт правового основания обработки ПД контактов и согласий (решение 111).
 *
 * Правила — чистые функции: что записать, чего не пускать. Сервис — с подменой
 * базы: кто вправе, что уходит в журнал, что возвращается наружу.
 */
const repo = vi.hoisted(() => ({
  changeContactBasis: vi.fn(),
  findContact: vi.fn(),
  findBasisHistory: vi.fn(),
}))
const audit = vi.hoisted(() => ({ writeAudit: vi.fn() }))

vi.mock('./universities.repo', () => repo)
vi.mock('@/shared/audit/audit', () => audit)

const { setContactBasis, withdrawContactConsent, contactBasisHistory, toContactDto } = await import(
  './universities.service'
)

const NOW = new Date('2026-09-25T12:00:00.000Z')
const OBTAINED_AT = '2026-09-01T00:00:00.000Z'
const REFERENCE = 'Согласие вх. № 12/2026 от 01.09.2026, папка «ПД контактов»'
const WITHDRAWAL = 'Письмо вх. № 45/2026 от 20.09.2026'

function user(role: UserRole): CurrentUser {
  return {
    id: `u-${role}`,
    email: `${role.toLowerCase()}@example.invalid`,
    fullName: 'Тестовый Пользователь',
    role,
    universityId: role === 'UNIVERSITY_REP' ? 'uni-1' : null,
  }
}

const PERSON: {
  id: string
  universityId: string
  fullName: string
  position: string | null
  email: string | null
  phone: string | null
  isPrimary: boolean
} = {
  id: 'c-1',
  universityId: 'uni-1',
  fullName: 'Ветрова Ирина Павловна',
  position: 'Заместитель декана',
  email: 'vetrova@example.invalid',
  phone: '+7 900 000-00-00',
  isPrimary: true,
}

const NO_BASIS = {
  legalBasis: null,
  consentStatus: 'NONE',
  consentObtainedAt: null,
  consentForm: null,
  consentWithdrawnAt: null,
  basisReference: null,
  withdrawalReference: null,
  basisUpdatedAt: null,
} as const

const CONSENT_OBTAINED = {
  legalBasis: 'CONSENT',
  consentStatus: 'OBTAINED',
  consentObtainedAt: new Date(OBTAINED_AT),
  consentForm: 'WRITTEN',
  consentWithdrawnAt: null,
  basisReference: REFERENCE,
  withdrawalReference: null,
  basisUpdatedAt: new Date(OBTAINED_AT),
} as const

type Row = typeof PERSON & {
  legalBasis: ContactForBasis['legalBasis']
  consentStatus: ContactForBasis['consentStatus']
  consentObtainedAt: Date | null
  consentForm: ContactForBasis['consentForm']
  consentWithdrawnAt: Date | null
  basisReference: string | null
  withdrawalReference: string | null
  basisUpdatedAt: Date | null
}

const live = (basis: Partial<Row> = {}): Row => ({ ...PERSON, ...NO_BASIS, ...basis })

/**
 * Подменённый репозиторий делает то же, что настоящий под блокировкой:
 * отдаёт текущую строку правилу и применяет план.
 */
function repoHolds(current: Row | null): void {
  repo.changeContactBasis.mockImplementation(
    async (_uni: string, _contact: string, _by: string, plan: (row: Row) => ContactBasisPlan | null) => {
      if (!current) return null
      const next = plan(current)
      if (!next) return { before: current, after: current, changed: false }
      return { before: current, after: { ...current, ...next.data }, changed: true }
    },
  )
}

beforeEach(() => {
  repo.changeContactBasis.mockReset()
  repo.findContact.mockReset()
  repo.findBasisHistory.mockReset()
  audit.writeAudit.mockReset()
})

describe('правило: зафиксировать основание', () => {
  it('законный интерес по договору с вузом — без даты и формы согласия', () => {
    const plan = planBasisChange(
      live(),
      { basis: 'LEGITIMATE_INTEREST', documentReference: 'Соглашение № 7/2026' },
      NOW,
    )
    expect(plan?.data).toMatchObject({
      legalBasis: 'LEGITIMATE_INTEREST',
      consentStatus: 'NONE',
      consentObtainedAt: null,
      consentForm: null,
      basisReference: 'Соглашение № 7/2026',
      basisUpdatedAt: NOW,
    })
    expect(plan?.history).toEqual({
      fromBasis: null,
      toBasis: 'LEGITIMATE_INTEREST',
      fromConsentStatus: 'NONE',
      toConsentStatus: 'NONE',
      consentObtainedAt: null,
      consentForm: null,
      consentWithdrawnAt: null,
      referenceChanged: true,
      anonymized: false,
    })
  })

  it('согласие — статус OBTAINED, дата и форма', () => {
    const plan = planBasisChange(
      live(),
      { basis: 'CONSENT', documentReference: REFERENCE, consentObtainedAt: OBTAINED_AT, consentForm: 'ELECTRONIC' },
      NOW,
    )
    expect(plan?.data).toMatchObject({
      legalBasis: 'CONSENT',
      consentStatus: 'OBTAINED',
      consentObtainedAt: new Date(OBTAINED_AT),
      consentForm: 'ELECTRONIC',
    })
    expect(plan?.history.toConsentStatus).toBe('OBTAINED')
  })

  it('согласие без даты или формы — 422 с полями', () => {
    expect(() =>
      planBasisChange(live(), { basis: 'CONSENT', documentReference: REFERENCE }, NOW),
    ).toThrowError(expect.objectContaining({
      code: 'VALIDATION_ERROR',
      details: [
        { field: 'consentObtainedAt', message: expect.any(String) },
        { field: 'consentForm', message: expect.any(String) },
      ],
    }))
  })

  it('дата согласия в будущем — 422', () => {
    expect(() =>
      planBasisChange(
        live(),
        { basis: 'CONSENT', documentReference: REFERENCE, consentObtainedAt: '2026-09-26T00:00:00.000Z', consentForm: 'WRITTEN' },
        NOW,
      ),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }))
  })

  it('дата или форма согласия при другом основании — 422: не бывает «согласие получено» при договоре', () => {
    expect(() =>
      planBasisChange(
        live(),
        { basis: 'CONTRACT', documentReference: 'Договор № 3', consentForm: 'WRITTEN' },
        NOW,
      ),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }))
  })

  it('та же форма повторно — null: ни истории, ни журнала', () => {
    expect(
      planBasisChange(
        live(CONSENT_OBTAINED),
        { basis: 'CONSENT', documentReference: REFERENCE, consentObtainedAt: OBTAINED_AT, consentForm: 'WRITTEN' },
        NOW,
      ),
    ).toBeNull()
  })

  it('с согласия на законный интерес (ч. 2 ст. 9) — сведения о согласии очищаются в карточке', () => {
    const plan = planBasisChange(
      live(CONSENT_OBTAINED),
      { basis: 'LEGITIMATE_INTEREST', documentReference: REFERENCE },
      NOW,
    )
    expect(plan?.data).toMatchObject({ consentStatus: 'NONE', consentObtainedAt: null, consentForm: null })
    expect(plan?.history).toMatchObject({
      fromBasis: 'CONSENT',
      fromConsentStatus: 'OBTAINED',
      toConsentStatus: 'NONE',
      referenceChanged: false,
    })
  })

  it('обезличенный контакт — 409', () => {
    const anonymized = live({ ...ANONYMIZED_CONTACT_FIELDS })
    expect(isAnonymizedContact(anonymized)).toBe(true)
    expect(() =>
      planBasisChange(anonymized, { basis: 'OTHER', documentReference: 'Приказ № 1' }, NOW),
    ).toThrowError(expect.objectContaining({ code: 'CONFLICT' }))
  })

  it('отозванное согласие — 409: вернуть его задним числом нельзя', () => {
    const withdrawn = live({
      ...CONSENT_OBTAINED,
      consentStatus: 'WITHDRAWN',
      consentWithdrawnAt: NOW,
      withdrawalReference: WITHDRAWAL,
      fullName: 'Кто-то ещё не обезличенный',
    })
    expect(() =>
      planBasisChange(withdrawn, { basis: 'LEGITIMATE_INTEREST', documentReference: REFERENCE }, NOW),
    ).toThrowError(expect.objectContaining({ code: 'CONFLICT' }))
  })
})

describe('правило: отозвать согласие', () => {
  it('действующее согласие — статус WITHDRAWN и обезличивание тем же набором полей', () => {
    const plan = planConsentWithdrawal(
      live(CONSENT_OBTAINED),
      { withdrawnAt: '2026-09-20T00:00:00.000Z', withdrawalReference: WITHDRAWAL },
      NOW,
    )
    expect(plan?.data).toMatchObject({
      ...ANONYMIZED_CONTACT_FIELDS,
      legalBasis: 'CONSENT',
      consentStatus: 'WITHDRAWN',
      consentWithdrawnAt: new Date('2026-09-20T00:00:00.000Z'),
      withdrawalReference: WITHDRAWAL,
      // Дата и форма согласия остаются: это доказательство законности обработки до отзыва.
      consentObtainedAt: new Date(OBTAINED_AT),
      consentForm: 'WRITTEN',
    })
    expect(plan?.history).toMatchObject({
      fromConsentStatus: 'OBTAINED',
      toConsentStatus: 'WITHDRAWN',
      anonymized: true,
      referenceChanged: true,
    })
    expect(basisHistoryKind(plan!.history)).toBe('consent.withdraw')
  })

  it('без даты — отзыв получен сейчас', () => {
    const plan = planConsentWithdrawal(live(CONSENT_OBTAINED), { withdrawalReference: WITHDRAWAL }, NOW)
    expect(plan?.data.consentWithdrawnAt).toEqual(NOW)
  })

  it('уже обезличенный контакт — отзыв фиксируется, повторного обезличивания нет', () => {
    const plan = planConsentWithdrawal(
      live({ ...CONSENT_OBTAINED, ...ANONYMIZED_CONTACT_FIELDS }),
      { withdrawalReference: WITHDRAWAL },
      NOW,
    )
    expect(plan?.data.fullName).toBeUndefined()
    expect(plan?.history.anonymized).toBe(false)
  })

  it('повтор — null', () => {
    const withdrawn = live({
      ...CONSENT_OBTAINED,
      ...ANONYMIZED_CONTACT_FIELDS,
      consentStatus: 'WITHDRAWN',
      consentWithdrawnAt: NOW,
      withdrawalReference: WITHDRAWAL,
    })
    expect(planConsentWithdrawal(withdrawn, { withdrawalReference: WITHDRAWAL }, NOW)).toBeNull()
  })

  it.each([
    ['основание не зафиксировано', live()],
    ['законный интерес', live({ legalBasis: 'LEGITIMATE_INTEREST', basisReference: REFERENCE, basisUpdatedAt: NOW })],
  ])('%s — 409, отзывать нечего', (_name, current) => {
    expect(() => planConsentWithdrawal(current, { withdrawalReference: WITHDRAWAL }, NOW)).toThrowError(
      expect.objectContaining({ code: 'CONFLICT' }),
    )
  })

  it('дата отзыва в будущем или раньше согласия — 422', () => {
    for (const withdrawnAt of ['2026-09-26T00:00:00.000Z', '2026-08-01T00:00:00.000Z']) {
      expect(() =>
        planConsentWithdrawal(live(CONSENT_OBTAINED), { withdrawnAt, withdrawalReference: WITHDRAWAL }, NOW),
      ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }))
    }
  })

  it('вид записи истории по переходу статуса', () => {
    expect(basisHistoryKind({ fromConsentStatus: 'NONE', toConsentStatus: 'OBTAINED' })).toBe('basis.set')
    expect(basisHistoryKind({ fromConsentStatus: 'OBTAINED', toConsentStatus: 'NONE' })).toBe('basis.set')
    expect(basisHistoryKind({ fromConsentStatus: 'OBTAINED', toConsentStatus: 'WITHDRAWN' })).toBe('consent.withdraw')
  })
})

describe('карточка: основание — ADMIN и MANAGER, остальным только признак', () => {
  const recorded = live(CONSENT_OBTAINED)

  it('с правом — основание, согласие и документ', () => {
    expect(toContactDto(recorded, true, true)).toMatchObject({
      basisRecorded: true,
      legalBasis: {
        basis: 'CONSENT',
        consentStatus: 'OBTAINED',
        consentObtainedAt: OBTAINED_AT,
        consentForm: 'WRITTEN',
        consentWithdrawnAt: null,
        documentReference: REFERENCE,
        withdrawalReference: null,
        updatedAt: OBTAINED_AT,
      },
    })
  })

  it('без права — признак есть, самого основания и документа в ответе нет', () => {
    const dto = toContactDto(recorded, true, false)
    expect(dto.basisRecorded).toBe(true)
    expect(dto.legalBasis).toBeNull()
    expect(JSON.stringify(dto)).not.toContain(REFERENCE)
  })

  it('не зафиксировано — признак false у всех', () => {
    expect(toContactDto(live(), true, true)).toMatchObject({ basisRecorded: false, legalBasis: null })
  })
})

describe('PUT …/legal-basis и POST …/consent/withdraw — права и журнал', () => {
  const setInput = { basis: 'LEGITIMATE_INTEREST' as const, documentReference: 'Соглашение № 7/2026' }

  it.each(['ANALYST', 'VIEWER', 'UNIVERSITY_REP'] as const)('%s — 403, база не трогается', async (role) => {
    await expect(setContactBasis(user(role), 'uni-1', 'c-1', setInput, NOW)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(
      withdrawContactConsent(user(role), 'uni-1', 'c-1', { withdrawalReference: WITHDRAWAL }, NOW),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      contactBasisHistory(user(role), 'uni-1', 'c-1', { page: 1, pageSize: 20 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(repo.changeContactBasis).not.toHaveBeenCalled()
    expect(repo.findBasisHistory).not.toHaveBeenCalled()
  })

  it('контакт другого вуза — 404', async () => {
    repoHolds(null)
    await expect(setContactBasis(user('MANAGER'), 'uni-2', 'c-1', setInput, NOW)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    repo.findContact.mockResolvedValue(null)
    await expect(
      contactBasisHistory(user('MANAGER'), 'uni-2', 'c-1', { page: 1, pageSize: 20 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it.each(['ADMIN', 'MANAGER'] as const)('%s фиксирует; в журнал — коды без ПД и без текста документа', async (role) => {
    repoHolds(live())
    const dto = await setContactBasis(user(role), 'uni-1', 'c-1', setInput, NOW)

    expect(dto.legalBasis).toMatchObject({ basis: 'LEGITIMATE_INTEREST', documentReference: 'Соглашение № 7/2026' })
    expect(audit.writeAudit).toHaveBeenCalledTimes(1)
    const entry = audit.writeAudit.mock.calls[0]?.[0]
    expect(entry).toEqual({
      userId: `u-${role}`,
      action: 'contact.basis.set',
      objectType: 'Contact',
      objectId: 'c-1',
      payload: {
        universityId: 'uni-1',
        fromBasis: null,
        toBasis: 'LEGITIMATE_INTEREST',
        fromConsentStatus: 'NONE',
        toConsentStatus: 'NONE',
        referenceChanged: true,
      },
    })
    const serialized = JSON.stringify(entry)
    for (const value of [PERSON.fullName, PERSON.email!, PERSON.phone!, PERSON.position!, 'Соглашение']) {
      expect(serialized).not.toContain(value)
    }
  })

  it('повтор той же формы — журнал не засоряется', async () => {
    repoHolds(live({ legalBasis: 'LEGITIMATE_INTEREST', basisReference: 'Соглашение № 7/2026', basisUpdatedAt: NOW }))
    await setContactBasis(user('MANAGER'), 'uni-1', 'c-1', setInput, NOW)
    expect(audit.writeAudit).not.toHaveBeenCalled()
  })

  it('отзыв: контакт обезличен, в журнал — отзыв и обезличивание, без ПД', async () => {
    repoHolds(live(CONSENT_OBTAINED))
    const dto = await withdrawContactConsent(
      user('MANAGER'),
      'uni-1',
      'c-1',
      { withdrawalReference: WITHDRAWAL },
      NOW,
    )

    expect(dto).toMatchObject({
      fullName: ANONYMIZED_CONTACT_NAME,
      email: null,
      phone: null,
      isAnonymized: true,
      isPrimary: false,
      basisRecorded: true,
      legalBasis: { consentStatus: 'WITHDRAWN', withdrawalReference: WITHDRAWAL },
    })
    expect(audit.writeAudit.mock.calls.map((call) => call[0].action)).toEqual([
      'contact.consent.withdraw',
      'contact.anonymize',
    ])
    expect(audit.writeAudit.mock.calls[0]?.[0].payload).toEqual({ universityId: 'uni-1', anonymized: true })
    expect(audit.writeAudit.mock.calls[1]?.[0].payload).toEqual({
      universityId: 'uni-1',
      wasPrimary: true,
      reason: 'consent.withdraw',
    })
    const serialized = JSON.stringify(audit.writeAudit.mock.calls)
    for (const value of [PERSON.fullName, PERSON.email!, PERSON.phone!, WITHDRAWAL, REFERENCE]) {
      expect(serialized).not.toContain(value)
    }
  })

  it('повторный отзыв — тот же результат, журнал не засоряется', async () => {
    repoHolds(
      live({
        ...CONSENT_OBTAINED,
        ...ANONYMIZED_CONTACT_FIELDS,
        consentStatus: 'WITHDRAWN',
        consentWithdrawnAt: NOW,
        withdrawalReference: WITHDRAWAL,
      }),
    )
    const dto = await withdrawContactConsent(user('ADMIN'), 'uni-1', 'c-1', { withdrawalReference: WITHDRAWAL }, NOW)
    expect(dto.isAnonymized).toBe(true)
    expect(audit.writeAudit).not.toHaveBeenCalled()
  })

  it('история: коды и автор, новые сверху; вид записи вычислен', async () => {
    repo.findContact.mockResolvedValue(live())
    repo.findBasisHistory.mockResolvedValue({
      rows: [
        {
          id: 'h-2',
          fromBasis: 'CONSENT',
          toBasis: 'CONSENT',
          fromConsentStatus: 'OBTAINED',
          toConsentStatus: 'WITHDRAWN',
          consentObtainedAt: new Date(OBTAINED_AT),
          consentForm: 'WRITTEN',
          consentWithdrawnAt: NOW,
          referenceChanged: true,
          anonymized: true,
          changedAt: NOW,
          changedBy: { id: 'u-MANAGER', fullName: 'Кириллов Пётр Андреевич', role: 'MANAGER' },
        },
      ],
      total: 1,
    })
    const result = await contactBasisHistory(user('ADMIN'), 'uni-1', 'c-1', { page: 1, pageSize: 20 })
    expect(result.meta).toEqual({ page: 1, pageSize: 20, total: 1 })
    expect(result.data[0]).toMatchObject({
      kind: 'consent.withdraw',
      toConsentStatus: 'WITHDRAWN',
      consentWithdrawnAt: NOW.toISOString(),
      anonymized: true,
      changedAt: NOW.toISOString(),
    })
  })
})
