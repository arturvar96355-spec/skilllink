import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { UserRole } from '@/shared/contracts/enums'
import { canSeeContactDetails } from '@/shared/auth/permissions'
import { ANONYMIZED_CONTACT_NAME } from './universities.rules'

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
}))
const analytics = vi.hoisted(() => ({
  universityRatingsForPage: vi.fn(),
  universityRatings: vi.fn(),
}))

vi.mock('./universities.repo', () => repo)
vi.mock('@/modules/analytics/analytics.service', () => analytics)

const { getById, toContactDto } = await import('./universities.service')

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

const LIVE = {
  id: 'c-1',
  fullName: 'Ветрова Ирина Павловна',
  position: 'Заместитель декана',
  email: EMAIL,
  phone: PHONE,
  isPrimary: true,
}

const ANONYMIZED = {
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
    expect(toContactDto(LIVE, true)).toMatchObject({
      email: EMAIL,
      phone: PHONE,
      contactDetailsHidden: false,
      isAnonymized: false,
    })
  })

  it('без права — null и признак «скрыто»; ФИО и должность остаются', () => {
    expect(toContactDto(LIVE, false)).toEqual({
      id: 'c-1',
      fullName: LIVE.fullName,
      position: LIVE.position,
      email: null,
      phone: null,
      isPrimary: true,
      isAnonymized: false,
      contactDetailsHidden: true,
    })
  })

  it('обезличенный контакт не «скрыт»: данных нет ни у кого', () => {
    expect(toContactDto(ANONYMIZED, false)).toMatchObject({
      isAnonymized: true,
      contactDetailsHidden: false,
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
