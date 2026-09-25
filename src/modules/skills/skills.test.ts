import { describe, expect, it } from 'vitest'
import { SKILL_GAP } from '@/shared/config/analytics.config'
import {
  calculateGap,
  coverageByLevel,
  demandNormalizer,
  demandPerSkill,
  latestOfPeriods,
  directionGroup,
  isInProfile,
  outOfProfileNote,
  combineProgramLinks,
  combineRelevance,
  duplicateSkillConflict,
  findNameClash,
  isSkillUsed,
  planSkillMerge,
  skillInUseMessage,
  skillNameKey,
  type DemandLink,
  type DirectionProfile,
  type ProgramSkillLink,
  type SkillLinks,
} from './skills.rules'
import { createSkillSchema, updateSkillSchema } from './skills.schema'
import { SKILL_NAME_KEY_SAMPLES } from './skill-name-key.samples'

describe('покрытие навыка программой', () => {
  it('без навыка покрытие равно нулю', () => {
    expect(coverageByLevel(null)).toBe(0)
  })

  it('растёт вместе с уровнем освоения', () => {
    expect(coverageByLevel('BASIC')).toBeLessThan(coverageByLevel('INTERMEDIATE'))
    expect(coverageByLevel('INTERMEDIATE')).toBeLessThan(coverageByLevel('ADVANCED'))
    expect(coverageByLevel('ADVANCED')).toBe(1)
  })
})

describe('нормирование спроса', () => {
  it('приводит выборку к диапазону 0..1', () => {
    const normalize = demandNormalizer([100, 500, 900])
    expect(normalize(100)).toBe(0)
    expect(normalize(900)).toBe(1)
    expect(normalize(500)).toBe(0.5)
  })

  it('на пустой выборке возвращает null, а не ноль', () => {
    const normalize = demandNormalizer([])
    expect(normalize(500)).toBeNull()
  })
})

describe('дефицит навыка', () => {
  it('помечает критичным востребованный навык, которого нет в программе', () => {
    const result = calculateGap(0.9, null, 'Kubernetes')
    expect(result.isCritical).toBe(true)
    expect(result.coverage).toBe(0)
    expect(result.gap).toBe(0.9)
    expect(result.explanation).toContain('Kubernetes')
  })

  it('не считает критичным навык со слабым спросом', () => {
    const below = SKILL_GAP.demandThreshold - 0.1
    expect(calculateGap(below, null, 'Бизнес-анализ').isCritical).toBe(false)
  })

  it('не считает критичным навык, который программа покрывает', () => {
    expect(calculateGap(0.95, 'ADVANCED', 'Python').isCritical).toBe(false)
  })

  it('без данных о спросе не выдумывает дефицит', () => {
    const result = calculateGap(null, null, 'Редкий навык')
    expect(result.gap).toBe(0)
    expect(result.isCritical).toBe(false)
    expect(result.explanation).toContain('Нет данных')
  })

  it('дефицит не бывает отрицательным', () => {
    expect(calculateGap(0.2, 'ADVANCED', 'SQL').gap).toBe(0)
  })
})

describe('обрезание выборки не искажает счётчик', () => {
  const gaps = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      skillId: `s${index}`,
      gap: 1 - index / 100,
      isCritical: index % 2 === 0,
    }))

  it('total считается до обрезания, а не после', () => {
    // Система существует ради показа дефицитов. Если при limit=5 она сообщит
    // «найдено 5», она занижает ровно ту проблему, которую должна показывать.
    const all = gaps(18)
    const limit = 5
    const shown = all.slice(0, limit)

    expect(shown).toHaveLength(limit)
    expect(all.length).toBe(18)
    expect(all.length > shown.length).toBe(true)
  })

  it('признак обрезания честен в обе стороны', () => {
    const all = gaps(18)
    expect(all.length > all.slice(0, 5).length).toBe(true)
    expect(all.length > all.slice(0, 200).length).toBe(false)
  })
})

describe('последний период рыночных данных', () => {
  it('по календарю, а не по алфавиту', () => {
    // Строкой «2026-Q1» больше «2026-09»: буква после цифр. По календарю — наоборот.
    expect(latestOfPeriods(['2026-Q1', '2026-09'])).toBe('2026-09')
    expect(latestOfPeriods(['2025-Q4', '2026-Q1'])).toBe('2026-Q1')
    expect(latestOfPeriods(['2026-Q3', '2026-08'])).toBe('2026-Q3')
  })

  it('нет периодов — нет данных', () => {
    expect(latestOfPeriods([])).toBeNull()
  })
})

describe('спрос — одна строка на навык', () => {
  it('федеральный замер важнее регионального', () => {
    const rows = [
      { skillId: 'sql', value: 900, region: 'Москва' },
      { skillId: 'sql', value: 500, region: 'Россия' },
      { skillId: 'go', value: 40, region: 'Казань' },
      { skillId: 'go', value: 70, region: 'Москва' },
    ]
    const result = demandPerSkill(rows)
    expect(result).toHaveLength(2)
    expect(result.find((row) => row.skillId === 'sql')?.value).toBe(500)
    // Без федерального — наибольший региональный.
    expect(result.find((row) => row.skillId === 'go')?.value).toBe(70)
  })
})

describe('обоснование дефицита — целыми пунктами', () => {
  it('без дробей и точки в русском тексте, как в рекомендациях', () => {
    const critical = calculateGap(0.7033, null, 'PostgreSQL')
    expect(critical.explanation).toContain('(70 из 100)')
    const partial = calculateGap(0.5555, 'BASIC', 'Python')
    expect(partial.explanation).toBe('Спрос 56 из 100, покрытие программой 34 из 100')
    for (const text of [critical.explanation, partial.explanation]) {
      expect(text).not.toMatch(/\d\.\d/)
    }
  })
})

describe('дефициты вне профиля программы (решение 98)', () => {
  const profile: DirectionProfile = {
    group: '02',
    skillIds: new Set(['python', 'ml']),
    categories: new Set(['Языки программирования', 'Данные']),
  }

  it('группа направлений — первые две цифры кода', () => {
    expect(directionGroup('09.03.04')).toBe('09')
    expect(directionGroup(' 02.04.02 ')).toBe('02')
    expect(directionGroup(null)).toBeNull()
    expect(directionGroup('без кода')).toBeNull()
  })

  it('навык, который преподаёт группа, — в профиле', () => {
    expect(isInProfile({ id: 'python', category: 'Языки программирования' }, profile)).toBe(true)
  })

  it('навык той же области — в профиле', () => {
    expect(isInProfile({ id: 'analytics', category: 'Данные' }, profile)).toBe(true)
  })

  it('языки сравниваются поимённо: Python не делает «своей» Java', () => {
    expect(isInProfile({ id: 'java', category: 'Языки программирования' }, profile)).toBe(false)
  })

  it('чужая область — вне профиля, пояснение называет группу и область', () => {
    expect(isInProfile({ id: 'k8s', category: 'DevOps' }, profile)).toBe(false)
    expect(outOfProfileNote('DevOps', '02')).toContain('группы направлений 02')
    expect(outOfProfileNote('DevOps', '02')).toContain('«DevOps»')
    expect(outOfProfileNote('Языки программирования', '02')).toContain('этот язык')
  })
})

describe('справочник навыков: уникальность названия (решение 107)', () => {
  const existing = [
    { id: 'ml', name: 'Machine Learning' },
    { id: 'py', name: 'Python' },
    { id: 'is', name: 'Информационная безопасность' },
  ]

  it('без учёта регистра и пробелов — в том числе внутри и неразрывных', () => {
    expect(skillNameKey('Machine Learning')).toBe(skillNameKey('machine   learning'))
    expect(skillNameKey('Machine Learning')).toBe(skillNameKey('MachineLearning'))
    expect(skillNameKey('Machine\u00a0Learning')).toBe(skillNameKey('machine learning'))
    expect(findNameClash('  PYTHON ', existing)?.id).toBe('py')
    expect(findNameClash('информационная  БЕЗОПАСНОСТЬ', existing)?.id).toBe('is')
  })

  it('трудные примеры: ключ тот же, что у индекса базы (db:verify сверяет базу с этим набором)', () => {
    for (const [input, key] of SKILL_NAME_KEY_SAMPLES) expect(skillNameKey(input), input).toBe(key)
    // «ML Ops» и «MLOps» — один навык и в справочнике, и при загрузке рыночных данных.
    expect(skillNameKey('ML Ops')).toBe(skillNameKey('MLOps'))
  })

  it('разные навыки не путаются', () => {
    expect(findNameClash('Java', existing)).toBeNull()
    expect(findNameClash('JavaScript', [{ id: 'j', name: 'Java' }])).toBeNull()
  })

  it('своё название в другом регистре при переименовании — не дубль', () => {
    expect(findNameClash('python', existing, 'py')).toBeNull()
    expect(findNameClash('python', existing, 'ml')?.id).toBe('py')
  })

  it('отказ — 409 с полем name и найденным названием', () => {
    const error = duplicateSkillConflict('machine learning', 'Machine Learning')
    expect(error.status).toBe(409)
    expect(error.message).toContain('«Machine Learning»')
    expect(error.details).toEqual([{ field: 'name', message: expect.stringContaining('Machine Learning') }])
  })

  it('схема обрезает края и сводит пробелы внутри; одна буква — законное название', () => {
    const parsed = createSkillSchema.parse({ name: '  Machine    Learning ', category: ' Данные ' })
    expect(parsed.name).toBe('Machine Learning')
    expect(parsed.category).toBe('Данные')
    expect(createSkillSchema.safeParse({ name: 'C', category: 'Языки программирования' }).success).toBe(true)
    expect(createSkillSchema.safeParse({ name: '   ', category: 'Данные' }).success).toBe(false)
    expect(updateSkillSchema.safeParse({}).success).toBe(false)
  })
})

describe('объединение дубля: конфликты связей (решение 107)', () => {
  const link = (over: Partial<ProgramSkillLink>): ProgramSkillLink => ({
    id: 'x',
    programId: 'p1',
    level: 'BASIC',
    importance: 'MEDIUM',
    source: 'CURRICULUM',
    confidence: null,
    comment: null,
    ...over,
  })
  const demand = (over: Partial<DemandLink>): DemandLink => ({
    id: 'd',
    period: '2026-Q1',
    source: 'Демо',
    region: 'Россия',
    value: 100,
    unit: 'vacancies',
    confidence: 'LOW',
    isMock: true,
    dataSourceId: null,
    ...over,
  })
  const empty = (): SkillLinks => ({ programs: [], products: [], demand: [], recommendations: [] })

  it('программа учит обоим — остаются наибольшие уровень, важность и уверенность', () => {
    const merged = combineProgramLinks(
      link({ level: 'INTERMEDIATE', importance: 'CRITICAL', confidence: 'LOW', source: 'EXPERT', comment: null }),
      link({ level: 'ADVANCED', importance: 'LOW', confidence: 'HIGH', source: 'CURRICULUM', comment: 'из дубля' }),
    )
    expect(merged).toEqual({
      level: 'ADVANCED',
      importance: 'CRITICAL',
      confidence: 'HIGH',
      // Происхождение — от связи с более высоким уровнем.
      source: 'CURRICULUM',
      comment: 'из дубля',
    })
  })

  it('при равном уровне происхождение и комментарий — целевого; неизвестная уверенность не затирает известную', () => {
    const merged = combineProgramLinks(
      link({ level: 'BASIC', source: 'EXPERT', comment: 'целевой', confidence: null }),
      link({ level: 'BASIC', source: 'IMPORT', comment: 'дубль', confidence: 'MEDIUM' }),
    )
    expect(merged.source).toBe('EXPERT')
    expect(merged.comment).toBe('целевой')
    expect(merged.confidence).toBe('MEDIUM')
  })

  it('продукт даёт оба — ключевой сильнее смежного и дополнительного', () => {
    expect(combineRelevance('OPTIONAL', 'CORE')).toBe('CORE')
    expect(combineRelevance('RELATED', 'OPTIONAL')).toBe('RELATED')
  })

  it('план: без совпадений всё переносится, совпадения объединяются, рыночный замер — максимум', () => {
    const target: SkillLinks = {
      programs: [link({ id: 't-p1', programId: 'p1', level: 'BASIC' })],
      products: [{ id: 't-pr1', productId: 'pr1', relevance: 'OPTIONAL' }],
      demand: [demand({ id: 't-d1', value: 500 }), demand({ id: 't-d2', region: 'Москва', value: 50 })],
      recommendations: [{ id: 't-r1', ruleKey: 'skill.critical-gap-with-product' }],
    }
    const duplicate: SkillLinks = {
      programs: [
        link({ id: 'd-p1', programId: 'p1', level: 'ADVANCED' }),
        link({ id: 'd-p2', programId: 'p2' }),
      ],
      products: [
        { id: 'd-pr1', productId: 'pr1', relevance: 'CORE' },
        { id: 'd-pr2', productId: 'pr2', relevance: 'RELATED' },
      ],
      demand: [
        demand({ id: 'd-d1', value: 300 }),
        demand({ id: 'd-d2', region: 'Москва', value: 80 }),
        demand({ id: 'd-d3', period: '2025-Q4', value: 10 }),
      ],
      recommendations: [
        { id: 'd-r1', ruleKey: 'skill.critical-gap-with-product' },
        { id: 'd-r2', ruleKey: 'skill.other' },
      ],
    }

    const plan = planSkillMerge(target, duplicate)

    expect(plan.programs.move).toEqual(['d-p2'])
    expect(plan.programs.combine).toHaveLength(1)
    expect(plan.programs.combine[0]).toMatchObject({ targetId: 't-p1', duplicateId: 'd-p1' })
    expect(plan.programs.combine[0]!.data.level).toBe('ADVANCED')

    expect(plan.products.move).toEqual(['d-pr2'])
    expect(plan.products.combine).toEqual([{ targetId: 't-pr1', duplicateId: 'd-pr1', relevance: 'CORE' }])

    expect(plan.demand.move).toEqual(['d-d3'])
    // Федеральный: у целевого 500 больше 300 — остаётся целевой. Москва: у дубля 80 больше 50 — его значение.
    expect(plan.demand.combine).toEqual([
      { targetId: 't-d1', duplicateId: 'd-d1', replaceWith: null },
      { targetId: 't-d2', duplicateId: 'd-d2', replaceWith: expect.objectContaining({ value: 80 }) },
    ])

    expect(plan.recommendations).toEqual({ move: ['d-r2'], drop: ['d-r1'] })
  })

  it('объединение не снижает покрытие ни одной программы', () => {
    const target: SkillLinks = { ...empty(), programs: [link({ id: 't', programId: 'p1', level: 'ADVANCED' })] }
    const duplicate: SkillLinks = { ...empty(), programs: [link({ id: 'd', programId: 'p1', level: 'BASIC' })] }
    const plan = planSkillMerge(target, duplicate)
    expect(coverageByLevel(plan.programs.combine[0]!.data.level)).toBe(coverageByLevel('ADVANCED'))
  })

  it('у дубля нет связей — план пуст', () => {
    const plan = planSkillMerge(empty(), empty())
    expect(plan.programs.move.length + plan.demand.move.length + plan.recommendations.drop.length).toBe(0)
  })
})

describe('удаление навыка: только неиспользуемый (решение 107)', () => {
  it('любое использование запрещает удаление', () => {
    expect(isSkillUsed({ programs: 0, products: 0, demand: 0, recommendations: 0 })).toBe(false)
    expect(isSkillUsed({ programs: 0, products: 0, demand: 1, recommendations: 0 })).toBe(true)
    expect(isSkillUsed({ programs: 0, products: 0, demand: 0, recommendations: 1 })).toBe(true)
  })

  it('объяснение называет, сколько где используется, с верным склонением', () => {
    const message = skillInUseMessage('Python', { programs: 6, products: 1, demand: 2, recommendations: 0 })
    expect(message).toContain('«Python»')
    expect(message).toContain('в 6 программах')
    expect(message).toContain('в 1 IT-продукте')
    expect(message).toContain('в 2 рыночных показателях')
    expect(message).not.toContain('рекомендац')
    expect(message).toContain('объедините')
  })
})
