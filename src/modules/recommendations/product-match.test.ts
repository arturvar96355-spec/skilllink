import { describe, expect, it } from 'vitest'
import {
  buildDemand,
  buildProfiles,
  cardSummary,
  confidenceOf,
  evaluatePair,
  portfolioSummary,
  recommendForPortfolio,
  recommendForProgram,
  recommendForUniversity,
  type MatchContext,
  type MatchCooperation,
  type MatchProduct,
  type MatchProgram,
} from './product-match.rules'

const NOW = new Date('2026-09-28T12:00:00Z')

/**
 * Спрос: Kubernetes 1000 (→ 100), Docker 600 (→ 56), SQL 200 (→ 11), Java 100 (→ 0).
 * Нормировка по min–max всех навыков периода — как во вкладке «Дефициты».
 */
const DEMAND = [
  { skillId: 'k8s', value: 1000, unit: 'vacancies', region: 'Россия', isMock: true },
  { skillId: 'docker', value: 600, unit: 'vacancies', region: 'Россия', isMock: true },
  { skillId: 'sql', value: 200, unit: 'vacancies', region: 'Россия', isMock: true },
  { skillId: 'java', value: 100, unit: 'vacancies', region: 'Россия', isMock: true },
  // Региональный замер того же навыка не удваивает его: берётся федеральный.
  { skillId: 'k8s', value: 5000, unit: 'vacancies', region: 'Москва', isMock: true },
]

function program(overrides: Partial<MatchProgram> = {}): MatchProgram {
  return {
    id: 'p1',
    name: 'Программная инженерия',
    code: '09.03.04',
    universityId: 'u1',
    universityName: 'СПбГУТ',
    skills: [
      { skillId: 'sql', level: 'ADVANCED', category: 'Данные' },
      { skillId: 'docker', level: 'BASIC', category: 'Инфраструктура' },
      { skillId: 'python', level: 'ADVANCED', category: 'Языки программирования' },
      { skillId: 'git', level: 'INTERMEDIATE', category: 'Инструменты' },
      { skillId: 'linux', level: 'INTERMEDIATE', category: 'Инфраструктура' },
    ],
    ...overrides,
  }
}

const CLOUD: MatchProduct = {
  id: 'cloud',
  name: 'Облачная платформа',
  category: 'Инфраструктура',
  skills: [
    { skillId: 'k8s', name: 'Kubernetes', category: 'Инфраструктура', relevance: 'CORE' },
    { skillId: 'docker', name: 'Docker', category: 'Инфраструктура', relevance: 'CORE' },
    { skillId: 'linux', name: 'Linux', category: 'Инфраструктура', relevance: 'RELATED' },
  ],
}

const DB: MatchProduct = {
  id: 'db',
  name: 'Учебная СУБД',
  category: 'Данные',
  skills: [{ skillId: 'sql', name: 'SQL', category: 'Данные', relevance: 'CORE' }],
}

const JAVA: MatchProduct = {
  id: 'java',
  name: 'Среда Java',
  category: 'Разработка',
  skills: [
    { skillId: 'java', name: 'Java', category: 'Языки программирования', relevance: 'CORE' },
    { skillId: 'k8s', name: 'Kubernetes', category: 'Инфраструктура', relevance: 'OPTIONAL' },
  ],
}

function context(cooperations: MatchCooperation[] = [], programs: MatchProgram[] = [program()]): MatchContext {
  const { demand, isMock } = buildDemand(DEMAND)
  return { demand, isMock, profiles: buildProfiles(programs), cooperations, now: NOW }
}

function cooperation(overrides: Partial<MatchCooperation>): MatchCooperation {
  return {
    programId: 'p1',
    programName: 'Программная инженерия',
    universityId: 'u1',
    productId: 'cloud',
    productName: 'Облачная платформа',
    status: 'ACTIVE',
    closedAt: null,
    updatedAt: NOW,
    ...overrides,
  }
}

describe('рекомендации продуктов: балл пары', () => {
  it('продукт, который закрывает дефициты, получает балл по формуле и причины с цифрами', () => {
    const { recommendation } = evaluatePair(program(), CLOUD, context())
    expect(recommendation).not.toBeNull()
    // Kubernetes: спрос 1, покрытие 0 → 1 × 1; Docker: 0,556 − 0,34 = 0,216 × 1;
    // Linux: нет спроса → 0 × 0,6. Сумма весов 2,6 → 100 × 1,216 / 2,6 = 47.
    expect(recommendation!.baseScore).toBe(47)
    expect(recommendation!.score).toBe(47)
    expect(recommendation!.closes.map((skill) => skill.name)).toEqual(['Kubernetes', 'Docker'])
    expect(recommendation!.reasons[0]).toBe(
      'Закроет 2 дефицитных навыка: Kubernetes (спрос 100, в программе нет), Docker (спрос 56, в программе базовый уровень)',
    )
    expect(recommendation!.reasons[1]).toMatch(/1\s000 вакансий за период/)
    expect(recommendation!.reasons[1]).toContain('ключевой навык продукта')
  })

  it('региональный замер не подменяет федеральный', () => {
    const { demand } = buildDemand(DEMAND)
    expect(demand.get('k8s')?.value).toBe(1000)
  })

  it('порядок: сначала то, что закрывает больше дефицита', () => {
    const { items } = recommendForProgram(program(), [DB, JAVA, CLOUD], context())
    expect(items.map((item) => item.product.id)).toEqual(['cloud', 'java'])
    expect(items[0]!.score).toBeGreaterThan(items[1]!.score)
  })

  it('продукт, навыки которого программа уже даёт, не предлагается — с объяснением', () => {
    const { recommendation, excluded } = evaluatePair(program(), DB, context())
    expect(recommendation).toBeNull()
    expect(excluded?.reason).toBe('Программа уже покрывает навыки продукта — дефицитов он не закрывает')
  })

  it('уже подключённый к программе продукт не предлагается', () => {
    const active = evaluatePair(program(), CLOUD, context([cooperation({ status: 'ACTIVE' })]))
    expect(active.recommendation).toBeNull()
    expect(active.excluded?.reason).toBe('Продукт уже подключён к программе — связка идёт')

    const done = evaluatePair(program(), CLOUD, context([cooperation({ status: 'COMPLETED' })]))
    expect(done.excluded?.reason).toBe('Продукт уже передан программе — связка завершена')
  })

  it('продукт у вуза по другой программе — минус 15 и причина', () => {
    const { recommendation } = evaluatePair(
      program(),
      CLOUD,
      context([cooperation({ programId: 'p2', programName: 'Информатика' })]),
    )
    expect(recommendation!.score).toBe(32)
    expect(recommendation!.adjustments).toEqual([
      expect.objectContaining({ kind: 'same-university', points: -15 }),
    ])
    expect(recommendation!.reasons.some((reason) => reason.includes('«Информатика»') && reason.includes('-15 к баллу'))).toBe(true)
  })

  it('недавно отменённая связка с этим продуктом — минус 40; давняя — без поправки', () => {
    const recent = evaluatePair(
      program(),
      CLOUD,
      context([cooperation({ status: 'CANCELLED', closedAt: new Date('2026-08-29T12:00:00Z') })]),
    )
    // 47 − 40 = 7 — ниже порога 10: не предлагается, и сказано почему.
    expect(recent.recommendation).toBeNull()
    expect(recent.excluded?.reason).toContain('отменена 30 дней назад')

    const old = evaluatePair(
      program(),
      CLOUD,
      context([cooperation({ status: 'CANCELLED', closedAt: new Date('2025-09-01T12:00:00Z') })]),
    )
    expect(old.recommendation?.score).toBe(47)
    expect(old.recommendation?.adjustments).toEqual([])
  })

  it('связка вуза с другим продуктом — причина «удобно предложить», балл не меняется', () => {
    const { recommendation } = evaluatePair(
      program(),
      CLOUD,
      context([cooperation({ programId: 'p2', programName: 'Информатика', productId: 'db', productName: 'Учебная СУБД' })]),
    )
    expect(recommendation!.score).toBe(47)
    expect(recommendation!.reasons).toContain(
      'У вуза уже идёт связка с продуктом «Учебная СУБД» (программа «Информатика») — удобно предложить на встрече по ней',
    )
  })

  it('навык вне профиля направления учитывается вполовину и назван в причинах', () => {
    // Группа 09 в выборке не преподаёт ни Kotlin, ни мобильную разработку — навык вне профиля.
    const mobile: MatchProduct = {
      id: 'mobile',
      name: 'Мобильная платформа',
      category: 'Мобильная разработка',
      skills: [{ skillId: 'kotlin', name: 'Kotlin', category: 'Мобильная разработка', relevance: 'CORE' }],
    }
    const base = context()
    const ctx: MatchContext = {
      ...base,
      demand: new Map([...base.demand, ['kotlin', { normalized: 1, value: 1000, unit: 'vacancies' }]]),
    }
    const { recommendation } = evaluatePair(program(), mobile, ctx)
    // Дефицит 1 × вес 1 × 0,5 вне профиля → 50, а не 100.
    expect(recommendation!.score).toBe(50)
    expect(recommendation!.closes[0]!.outOfProfile).toBe(true)
    expect(recommendation!.reasons).toContain('Kotlin — вне профиля направления: учтены с половинным весом')
  })

  it('дополнительный навык продукта весит меньше ключевого', () => {
    // Java: спрос 0 → дефицита нет; Kubernetes дополнительный: 1 × 0,3. 100 × 0,3 / 1,3 = 23.
    const { recommendation } = evaluatePair(program(), JAVA, context())
    expect(recommendation!.score).toBe(23)
    expect(recommendation!.closes.map((skill) => skill.name)).toEqual(['Kubernetes'])
  })

  it('программа без кода направления — профиль не применяется, половинного веса нет', () => {
    const noCode = program({ code: null, skills: [] })
    const ctx = context([], [noCode])
    const { recommendation } = evaluatePair(noCode, CLOUD, ctx)
    expect(recommendation!.closes.every((skill) => !skill.outOfProfile)).toBe(true)
  })
})

describe('рекомендации продуктов: крайние случаи', () => {
  it('у продукта нет навыков — не с чем сравнивать', () => {
    const empty: MatchProduct = { id: 'x', name: 'Пусто', category: 'Прочее', skills: [] }
    const { recommendation, excluded } = evaluatePair(program(), empty, context())
    expect(recommendation).toBeNull()
    expect(excluded?.reason).toContain('не записано навыков')
  })

  it('нет рыночных данных — ни одной рекомендации, причина названа', () => {
    const ctx: MatchContext = { ...context(), demand: new Map() }
    const { items, excluded } = recommendForProgram(program(), [CLOUD, JAVA], ctx)
    expect(items).toEqual([])
    expect(excluded.every((item) => item.reason === 'Нет рыночных данных ни по одному навыку продукта')).toBe(true)
    expect(cardSummary(items, 'program')).toContain('Предложить нечего')
  })

  it('у программы нет навыков — рекомендация есть, но уверенность низкая и это сказано', () => {
    const bare = program({ skills: [] })
    const { recommendation } = evaluatePair(bare, CLOUD, context([], [bare]))
    expect(recommendation!.confidence).toBe('LOW')
    expect(recommendation!.lowData).toBe(true)
    expect(recommendation!.confidenceNote).toContain('не записано ни одного навыка')
  })

  it('уверенность: высокая при полных данных, средняя — если спрос известен не по всем навыкам', () => {
    expect(confidenceOf({ programSkillCount: 6, productSkillCount: 3, productSkillsWithDemand: 3 }).confidence).toBe('HIGH')
    const medium = confidenceOf({ programSkillCount: 6, productSkillCount: 3, productSkillsWithDemand: 2 })
    expect(medium.confidence).toBe('MEDIUM')
    expect(medium.note).toBe('Данных не хватает: спрос рынка известен для 2 из 3 навыков продукта')
    expect(confidenceOf({ programSkillCount: 6, productSkillCount: 3, productSkillsWithDemand: 1 }).confidence).toBe('LOW')
  })

  it('вуз: продукт предлагается один раз — на лучшей для него программе', () => {
    const strong = program()
    const weak = program({
      id: 'p2',
      name: 'Информатика',
      skills: [...program().skills, { skillId: 'k8s', level: 'INTERMEDIATE', category: 'Инфраструктура' }],
    })
    const { items } = recommendForUniversity([weak, strong], [CLOUD], context([], [strong, weak]))
    expect(items).toHaveLength(1)
    expect(items[0]!.program.id).toBe('p1')
  })

  it('портфель: самые сильные программы каждого продукта и вывод одной фразой', () => {
    const covered = program({
      id: 'p3',
      name: 'Облачные технологии',
      skills: [
        ...program().skills,
        { skillId: 'k8s', level: 'ADVANCED', category: 'Инфраструктура' },
      ].map((skill) => ({ ...skill, level: 'ADVANCED' as const })),
    })
    const { items, programsWithout, reach } = recommendForPortfolio([program(), covered], [CLOUD, DB, JAVA], context())
    // У каждого продукта — его самые сильные программы; лучший для программы помечен.
    expect(items.map((item) => `${item.program.id}:${item.product.id}:${item.bestForProgram}`)).toEqual([
      'p1:cloud:true',
      'p1:java:false',
    ])
    expect(programsWithout).toBe(1)
    expect(portfolioSummary({ reach, programsWithout })).toBe(
      'Чаще всего лучший вариант — «Облачная платформа»: для 1 из 1 программы с рекомендацией. 1 программе предложить нечего — их навыки уже закрыты или данных нет.',
    )
  })

  it('портфель по одному продукту: все программы, которым он рекомендуется, и сводка по продуктам', () => {
    const second = program({ id: 'p2', name: 'Информатика', universityId: 'u2', universityName: 'МТУСИ' })
    const result = recommendForPortfolio([program(), second], [CLOUD, JAVA], context(), 'java')
    expect(result.items.map((item) => `${item.program.id}:${item.product.id}`)).toEqual(['p2:java', 'p1:java'])
    expect(result.reach).toEqual([
      { productId: 'cloud', productName: 'Облачная платформа', bestFor: 2, recommendedFor: 2, averageScore: 47 },
      { productId: 'java', productName: 'Среда Java', bestFor: 0, recommendedFor: 2, averageScore: 23 },
    ])
    expect(portfolioSummary({ ...result, product: { name: 'Среда Java', items: result.items } })).toBe(
      '«Среда Java» рекомендуется 2 программам; сильнее всего — «Информатика» (МТУСИ), балл 23.',
    )
  })
})

describe('рекомендации продуктов: портфель без повторов', () => {
  it('без выбранного продукта — не больше заданного числа программ на продукт', () => {
    const programs = ['a', 'b', 'c', 'd'].map((id) => program({ id, name: `Программа ${id}` }))
    const { items } = recommendForPortfolio(programs, [CLOUD], context(), undefined, 2)
    expect(items).toHaveLength(2)
  })
})
