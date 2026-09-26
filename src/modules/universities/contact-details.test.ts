import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { UserRole } from '@/shared/contracts/enums'
import { canSeeContactDetails } from '@/shared/auth/permissions'
import { ANONYMIZED_CONTACT_NAME } from './universities.rules'
import { revealContactSchema } from './universities.schema'

/**
 * Почта и телефон контактных лиц вузов — только ADMIN и MANAGER, представителю вуза —
 * своего вуза (решение 106, решение владельца 25.09.2026). Остальным — null и признак
 * «скрыто». Маскирование в сервисе: значения не должны уйти в ответ API вовсе.
 *
 * База и аналитика подменяются: проверяется то, что решает сервис.
 */
const repo = vi.hoisted(() => ({
  findById: vi.fn(),
  countActiveCooperations: vi.fn(),
  findContactById: vi.fn(),
}))
const audit = vi.hoisted(() => ({ writeAudit: vi.fn() }))
const analytics = vi.hoisted(() => ({
  universityRatingsForPage: vi.fn(),
  universityRatings: vi.fn(),
}))

vi.mock('./universities.repo', () => repo)
vi.mock('@/modules/analytics/analytics.service', () => analytics)
vi.mock('@/shared/audit/audit', () => audit)

const { getById, toContactDto, revealContact } = await import('./universities.service')

function user(role: UserRole, universityId: string | null = null): CurrentUser {
  return {
    id: `u-${role}`,
    email: `${role.toLowerCase()}@example.invalid`,
    fullName: 'Тестовый Пользователь',
    role,
    universityId: role === 'UNIVERSITY_REP' ? (universityId ?? 'uni-1') : null,
  }
}

const EMAIL = 'vetrova@example.invalid'
const PHONE = '+7 900 000-00-00'

/** Основание не зафиксировано — как у контактов, заведённых до решения 111. */
const NO_BASIS = {
  legalBasis: null,
  consentStatus: 'NONE',
  consentObtainedAt: null,
  consentForm: null,
  consentWithdrawnAt: null,
  basisReference: null,
  withdrawalReference: null,
  basisUpdatedAt: null,
  consentPolicyVersion: null,
  consentTextHash: null,
  consentContext: null,
} as const

const LIVE = {
  ...NO_BASIS,
  id: 'c-1',
  fullName: 'Ветрова Ирина Павловна',
  position: 'Заместитель декана',
  email: EMAIL,
  phone: PHONE,
  isPrimary: true,
}

const ANONYMIZED = {
  ...NO_BASIS,
  id: 'c-2',
  fullName: ANONYMIZED_CONTACT_NAME,
  position: null,
  email: null,
  phone: null,
  isPrimary: false,
}

const ROW = {
  id: 'uni-1',
  name: 'Тестовый университет',
  shortName: null,
  city: 'Москва',
  region: 'Москва',
  status: 'IN_PROGRESS',
  isMock: true,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
  archivedAt: null,
  _count: { programs: 0, cooperations: 0 },
  address: null,
  website: null,
  description: null,
  directionCount: null,
  studentCount: null,
  contacts: [LIVE, ANONYMIZED],
}

beforeEach(() => {
  repo.findById.mockReset().mockResolvedValue(ROW)
  repo.countActiveCooperations.mockReset().mockResolvedValue(new Map())
  analytics.universityRatingsForPage.mockReset().mockResolvedValue(new Map())
})

describe('право на почту и телефон контактов', () => {
  it.each([
    ['ADMIN', true],
    ['MANAGER', true],
    ['ANALYST', false],
    ['VIEWER', false],
  ] as const)('%s → %s для любого вуза', (role, expected) => {
    expect(canSeeContactDetails(user(role), 'uni-1')).toBe(expected)
    expect(canSeeContactDetails(user(role), 'uni-2')).toBe(expected)
  })

  it('представитель вуза — только свой вуз; без вуза (выгрузка) — нет', () => {
    expect(canSeeContactDetails(user('UNIVERSITY_REP', 'uni-1'), 'uni-1')).toBe(true)
    expect(canSeeContactDetails(user('UNIVERSITY_REP', 'uni-1'), 'uni-2')).toBe(false)
    expect(canSeeContactDetails(user('UNIVERSITY_REP', 'uni-1'))).toBe(false)
  })

  it('представитель без назначенного вуза не видит ничего', () => {
    const broken: CurrentUser = { ...user('UNIVERSITY_REP'), universityId: null }
    expect(canSeeContactDetails(broken, 'uni-1')).toBe(false)
  })
})

describe('маскирование контакта в DTO', () => {
  it('с правом — значения как есть, признака нет', () => {
    expect(toContactDto(LIVE, true, true)).toMatchObject({
      email: EMAIL,
      phone: PHONE,
      contactDetailsHidden: false,
      isAnonymized: false,
    })
  })

  it('без права — null и признак «скрыто»; ФИО и должность остаются', () => {
    expect(toContactDto(LIVE, false, false)).toEqual({
      id: 'c-1',
      fullName: LIVE.fullName,
      position: LIVE.position,
      email: null,
      phone: null,
      isPrimary: true,
      isAnonymized: false,
      contactDetailsHidden: true,
      // Решение 123: маски вместо «скрыто» — видно, что почта и телефон есть.
      emailMasked: 'v***@example.invalid',
      phoneMasked: '+7******00',
      basisRecorded: false,
      legalBasis: null,
    })
  })

  it('обезличенный контакт не «скрыт»: данных нет ни у кого', () => {
    expect(toContactDto(ANONYMIZED, false, false)).toMatchObject({
      isAnonymized: true,
      contactDetailsHidden: false,
      emailMasked: null,
      phoneMasked: null,
    })
  })
})

describe('GET /api/universities/:id — контакты по ролям', () => {
  it.each(['ANALYST', 'VIEWER'] as const)(
    '%s: почты и телефона нет нигде в ответе, признак стоит',
    async (role) => {
      const card = await getById(user(role), 'uni-1')
      const serialized = JSON.stringify(card)
      expect(serialized).not.toContain(EMAIL)
      expect(serialized).not.toContain(PHONE)
      expect(card.contacts[0]).toMatchObject({
        fullName: LIVE.fullName,
        position: LIVE.position,
        email: null,
        phone: null,
        contactDetailsHidden: true,
      })
      expect(card.primaryContact).toMatchObject({ email: null, contactDetailsHidden: true })
    },
  )

  it.each(['ADMIN', 'MANAGER'] as const)('%s: значения видны', async (role) => {
    const card = await getById(user(role), 'uni-1')
    expect(card.contacts[0]).toMatchObject({
      email: EMAIL,
      phone: PHONE,
      contactDetailsHidden: false,
    })
  })

  it('представитель своего вуза видит контакты как раньше', async () => {
    const card = await getById(user('UNIVERSITY_REP', 'uni-1'), 'uni-1')
    expect(card.contacts[0]).toMatchObject({
      email: EMAIL,
      phone: PHONE,
      contactDetailsHidden: false,
    })
  })
})

describe('раскрытие почты и телефона с журналом (решение 123)', () => {
  const REASON = 'Согласовать дату подписания соглашения, пишите ivanov@univ.ru'
  beforeEach(() => {
    audit.writeAudit.mockReset()
    repo.findContactById.mockReset().mockResolvedValue({ ...LIVE, universityId: 'uni-1' })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('менеджер раскрывает — значения в ответе, в журнале поля и причина с маской почты', async () => {
    const dto = await revealContact(user('MANAGER'), 'c-1', { reason: REASON }, new Date('2026-09-26T10:00:00Z'))
    expect(dto).toEqual({
      id: 'c-1',
      universityId: 'uni-1',
      email: EMAIL,
      phone: PHONE,
      revealedFields: ['email', 'phone'],
      revealedAt: '2026-09-26T10:00:00.000Z',
    })
    expect(audit.writeAudit).toHaveBeenCalledTimes(1)
    const entry = audit.writeAudit.mock.calls[0]![0] as { action: string; payload: Record<string, unknown> }
    expect(entry).toMatchObject({ action: 'contact.revealed', objectType: 'Contact', objectId: 'c-1' })
    expect(entry.payload).toMatchObject({ universityId: 'uni-1', fields: ['email', 'phone'] })
    expect(entry.payload.reason).toContain('i***@univ.ru')
    const logged = JSON.stringify(entry)
    expect(logged).not.toContain(EMAIL)
    expect(logged).not.toContain(PHONE)
    expect(logged).not.toContain('ivanov@univ.ru')
  })

  it('причина обязательна, не короче 10 символов; поля — только email и phone', () => {
    expect(revealContactSchema.safeParse({ reason: 'звонок' }).success).toBe(false)
    expect(revealContactSchema.safeParse({}).success).toBe(false)
    expect(revealContactSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false)
    expect(revealContactSchema.safeParse({ reason: REASON, fields: ['notes'] }).success).toBe(false)
    expect(revealContactSchema.safeParse({ reason: REASON, fields: ['email'] }).success).toBe(true)
  })

  it('только запрошенное поле', async () => {
    const dto = await revealContact(user('ADMIN'), 'c-1', { fields: ['phone'], reason: REASON })
    expect(dto).toMatchObject({ email: null, phone: PHONE, revealedFields: ['phone'] })
  })

  it.each(['ANALYST', 'VIEWER'] as const)('%s — 403 до поиска контакта (решение 106 не обходится причиной)', async (role) => {
    await expect(revealContact(user(role), 'c-1', { reason: REASON })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(repo.findContactById).not.toHaveBeenCalled()
    expect(audit.writeAudit).not.toHaveBeenCalled()
  })

  it('представитель: свой вуз — да, чужой — 404; обезличенный — 409; нет контакта — 404', async () => {
    await expect(revealContact(user('UNIVERSITY_REP', 'uni-1'), 'c-1', { reason: REASON })).resolves.toMatchObject({ email: EMAIL })
    await expect(revealContact(user('UNIVERSITY_REP', 'uni-2'), 'c-1', { reason: REASON })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    repo.findContactById.mockResolvedValue({ ...ANONYMIZED, universityId: 'uni-1' })
    await expect(revealContact(user('MANAGER'), 'c-2', { reason: REASON })).rejects.toMatchObject({ code: 'CONFLICT' })
    repo.findContactById.mockResolvedValue(null)
    await expect(revealContact(user('MANAGER'), 'nope', { reason: REASON })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('строгий режим CONTACT_REVEAL_REQUIRED: в карточке у менеджера только маски', async () => {
    vi.stubEnv('CONTACT_REVEAL_REQUIRED', 'true')
    const card = await getById(user('MANAGER'), 'uni-1')
    expect(card.contacts[0]).toMatchObject({ email: null, phone: null, contactDetailsHidden: true, emailMasked: 'v***@example.invalid' })
    expect(JSON.stringify(card)).not.toContain(EMAIL)
    // Раскрытие при этом работает.
    await expect(revealContact(user('MANAGER'), 'c-1', { reason: REASON })).resolves.toMatchObject({ email: EMAIL })
  })
})
