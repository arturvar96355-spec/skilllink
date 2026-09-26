import { describe, expect, it } from 'vitest'
import { QUALITY } from '@/shared/config/data-quality.config'
import { ANONYMIZED_CONTACT_FIELDS } from '@/modules/universities/universities.rules'
import { computeQualityReport, programLastUpdate, type DuplicateSummary, type QualityInput } from './quality.rules'

const NOW = new Date('2026-09-25T12:00:00Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)

const contact = { fullName: 'Иванов И. И.', position: null, email: 'a@example.invalid', phone: null }
const anonymized = { ...ANONYMIZED_CONTACT_FIELDS }

const noDuplicates = (): DuplicateSummary => ({
  university: { pairs: 0, ids: new Set() },
  skill: { pairs: 0, ids: new Set() },
  program: { pairs: 0, ids: new Set() },
  product: { pairs: 0, ids: new Set() },
})

function input(overrides: Partial<QualityInput> = {}): QualityInput {
  return {
    universities: [
      { id: 'u1', name: 'Первый', isMock: false, contacts: [contact], programs: [{ id: 'p1' }] },
      { id: 'u2', name: 'Второй', isMock: false, contacts: [contact], programs: [{ id: 'p2' }] },
    ],
    programs: [
      { id: 'p1', name: 'П1', isMock: false, updatedAt: daysAgo(10), metricsUpdatedAt: null, skills: [{ updatedAt: daysAgo(10) }] },
      { id: 'p2', name: 'П2', isMock: false, updatedAt: daysAgo(10), metricsUpdatedAt: null, skills: [{ updatedAt: daysAgo(10) }] },
    ],
    skills: [{ id: 's1', name: 'Python', _count: { programs: 2, demand: 1, products: 0 } }],
    products: [{ id: 'r1', name: 'Платформа', isMock: false, _count: { skills: 2 } }],
    cooperations: [
      {
        id: 'c1',
        isMock: false,
        createdAt: daysAgo(100),
        university: { name: 'Первый' },
        program: { name: 'П1' },
        responsible: { isActive: true },
        meetings: [{ date: daysAgo(5) }],
      },
    ],
    ...overrides,
  }
}

describe('оценка качества справочника', () => {
  it('без проблем — 100 у каждой сущности и в итоге', () => {
    const report = computeQualityReport(input(), noDuplicates(), NOW)
    expect(report.score).toBe(100)
    expect(report.entities.every((entity) => entity.score === 100)).toBe(true)
    expect(report.isMock).toBe(false)
  })

  it('веса проблем каждой сущности в сумме дают 1 — иначе «все проблемы» не было бы нулём', () => {
    for (const weights of Object.values(QUALITY.issueWeights)) {
      expect(Object.values(weights).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 9)
    }
    expect(Object.values(QUALITY.entityWeights).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 9)
  })

  it('формула: 100 × (1 − вес × доля) — половина вузов без контактов', () => {
    const report = computeQualityReport(
      input({
        universities: [
          { id: 'u1', name: 'Первый', isMock: false, contacts: [contact], programs: [{ id: 'p1' }] },
          // Обезличенный контакт — всё равно что контакта нет.
          { id: 'u2', name: 'Второй', isMock: true, contacts: [anonymized], programs: [{ id: 'p2' }] },
        ],
      }),
      noDuplicates(),
      NOW,
    )
    const university = report.entities.find((entity) => entity.entity === 'university')!
    const issue = university.issues.find((item) => item.code === 'university.noContacts')!
    expect(issue).toMatchObject({ count: 1, share: 0.5, penalty: 100 * QUALITY.issueWeights.university.noContacts * 0.5 })
    expect(issue.items).toEqual([{ id: 'u2', name: 'Второй', href: '/universities/u2' }])
    expect(university.score).toBe(100 * (1 - QUALITY.issueWeights.university.noContacts * 0.5))
    expect(report.isMock).toBe(true)
  })

  it('итог — среднее с весами сущностей', () => {
    const report = computeQualityReport(
      input({ products: [{ id: 'r1', name: 'Платформа', isMock: false, _count: { skills: 0 } }] }),
      noDuplicates(),
      NOW,
    )
    const productScore = 100 * (1 - QUALITY.issueWeights.product.noSkills)
    // toBeCloseTo, а не toBe: округление в round1 и прямое умножение здесь расходятся в последнем разряде float.
    expect(report.entities.find((entity) => entity.entity === 'product')!.score).toBeCloseTo(productScore, 6)
    const expected = 100 - (100 - productScore) * QUALITY.entityWeights.product
    expect(report.score).toBeCloseTo(expected, 1)
  })

  it('сущность без записей — null и не участвует в итоге', () => {
    const report = computeQualityReport(input({ cooperations: [] }), noDuplicates(), NOW)
    expect(report.entities.find((entity) => entity.entity === 'cooperation')!.score).toBeNull()
    expect(report.score).toBe(100)
    expect(report.explanation).not.toContain('Связки')
  })

  it('пустой справочник — оценки нет, а не 0 и не 100', () => {
    const empty = computeQualityReport(
      { universities: [], programs: [], skills: [], products: [], cooperations: [] },
      noDuplicates(),
      NOW,
    )
    expect(empty.score).toBeNull()
  })

  it('программа устарела: последнее обновление — запись, показатели или навыки', () => {
    const stale = { id: 'p1', name: 'П1', isMock: false, updatedAt: daysAgo(400), metricsUpdatedAt: null, skills: [{ updatedAt: daysAgo(200) }] }
    const fresh = { ...stale, id: 'p2', metricsUpdatedAt: daysAgo(3) }
    expect(programLastUpdate(fresh)).toEqual(daysAgo(3))
    const report = computeQualityReport(input({ programs: [stale, fresh] }), noDuplicates(), NOW)
    const issue = report.entities.find((entity) => entity.entity === 'program')!.issues.find((item) => item.code === 'program.stale')!
    expect(issue.items.map((item) => item.id)).toEqual(['p1'])
  })

  it('навыки: «дыра» (спрос без программ) и мусор (ни спроса, ни программ)', () => {
    const report = computeQualityReport(
      input({
        skills: [
          { id: 's1', name: 'Python', _count: { programs: 2, demand: 1, products: 0 } },
          { id: 's2', name: 'Kubernetes', _count: { programs: 0, demand: 3, products: 1 } },
          { id: 's3', name: 'K8s', _count: { programs: 0, demand: 0, products: 0 } },
        ],
      }),
      noDuplicates(),
      NOW,
    )
    const skills = report.entities.find((entity) => entity.entity === 'skill')!
    expect(skills.issues.find((item) => item.code === 'skill.demandWithoutPrograms')!.items.map((item) => item.name)).toEqual(['Kubernetes'])
    expect(skills.issues.find((item) => item.code === 'skill.unused')!.items.map((item) => item.name)).toEqual(['K8s'])
  })

  it('связки: заблокированный ответственный и тишина больше 60 дней — от последней встречи, без встреч — от создания', () => {
    const base = input().cooperations[0]!
    const report = computeQualityReport(
      input({
        cooperations: [
          { ...base, id: 'c1', responsible: { isActive: false } },
          { ...base, id: 'c2', meetings: [{ date: daysAgo(90) }] },
          { ...base, id: 'c3', meetings: [], createdAt: daysAgo(10) },
          { ...base, id: 'c4', meetings: [], createdAt: daysAgo(70) },
        ],
      }),
      noDuplicates(),
      NOW,
    )
    const cooperation = report.entities.find((entity) => entity.entity === 'cooperation')!
    expect(cooperation.issues.find((item) => item.code === 'cooperation.noResponsible')!.items.map((item) => item.id)).toEqual(['c1'])
    expect(cooperation.issues.find((item) => item.code === 'cooperation.noMeetings')!.items.map((item) => item.id)).toEqual(['c2', 'c4'])
  })

  it('дубли: число пар по сущностям и записи в парах — проблема сущности', () => {
    const duplicates = noDuplicates()
    duplicates.university = { pairs: 1, ids: new Set(['u1', 'u2']) }
    const report = computeQualityReport(input(), duplicates, NOW)
    expect(report.duplicates.university).toBe(1)
    const issue = report.entities[0]!.issues.find((item) => item.code === 'university.duplicates')!
    expect(issue).toMatchObject({ count: 2, share: 1 })
  })

  it('примеров не больше sampleLimit', () => {
    const many = Array.from({ length: QUALITY.sampleLimit + 5 }, (_, index) => ({
      id: `u${index}`,
      name: `Вуз ${index}`,
      isMock: false,
      contacts: [],
      programs: [],
    }))
    const report = computeQualityReport(input({ universities: many }), noDuplicates(), NOW)
    const issue = report.entities[0]!.issues.find((item) => item.code === 'university.noContacts')!
    expect(issue.count).toBe(many.length)
    expect(issue.items).toHaveLength(QUALITY.sampleLimit)
  })
})
