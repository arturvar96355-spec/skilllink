import { describe, expect, it } from 'vitest'
import type { ProductRecommendationDto } from '@/shared/contracts/product-recommendation'
import { parseProductOfferTargetId, productOfferTargetId } from '@/shared/contracts/ai-assist'
import { createRedactor } from './ai-assist.privacy'
import { buildProductOfferPrompt, buildRewritePrompt } from './ai-assist.prompts'
import { maskPersonName, productOfferFacts, productOfferLines, productOfferTemplate } from './product-offer.letter'

const RECOMMENDATION: ProductRecommendationDto = {
  program: { id: 'p1', name: 'Программная инженерия', universityId: 'u1', universityName: 'СПбГУТ' },
  product: { id: 'cloud', name: 'Облачная платформа РТК', category: 'Инфраструктура' },
  score: 47,
  baseScore: 47,
  adjustments: [],
  closes: [
    { skillId: 'k8s', name: 'Kubernetes', demand: 86, coverage: 0, level: null, gap: 86, relevance: 'CORE', outOfProfile: false, demandValue: 9400, demandUnit: 'вакансий' },
    { skillId: 'docker', name: 'Docker', demand: 65, coverage: 34, level: 'BASIC', gap: 31, relevance: 'CORE', outOfProfile: false, demandValue: 7260, demandUnit: 'вакансий' },
    { skillId: 'kotlin', name: 'Kotlin', demand: 40, coverage: 0, level: null, gap: 40, relevance: 'OPTIONAL', outOfProfile: true, demandValue: 3000, demandUnit: 'вакансий' },
  ],
  productSkillCount: 4,
  productSkillsWithDemand: 4,
  reasons: [],
  confidence: 'HIGH',
  confidenceNote: '',
  lowData: false,
}

const FACTS = productOfferFacts({
  recommendation: RECOMMENDATION,
  productSkills: ['Kubernetes', 'Docker', 'Linux', 'Kotlin'],
  period: '2026-Q3',
  existing: { programName: 'Информационная безопасность', productName: 'Киберполигон' },
})

describe('письмо вузу с предложением продукта', () => {
  it('факты: навыки в профиле с цифрами спроса, без оговорки «вне профиля»', () => {
    expect(FACTS.skills.map((skill) => skill.name)).toEqual(['Kubernetes', 'Docker'])
    expect(FACTS.skills[0]).toEqual({ name: 'Kubernetes', amount: '9 400 вакансий', demand: 86, inProgram: 'в программе нет' })
    const lines = productOfferLines(FACTS)
    expect(lines).toContain('Тема: IT-продукт «Облачная платформа РТК» для программы «Программная инженерия»')
    expect(lines.join('\n')).toContain('за 3-й квартал 2026 года: Kubernetes — 9 400 вакансий, спрос 86 из 100, в программе нет')
    expect(lines.join('\n')).not.toContain('профил')
  })

  it('шаблон: зачем, что даёт продукт, связка вуза и просьба о встрече — подпись ИТ-Школы', () => {
    const text = productOfferTemplate(FACTS)
    expect(text.startsWith('Тема: IT-продукт «Облачная платформа РТК»')).toBe(true)
    expect(text).toContain('— Kubernetes: 9 400 вакансий, в программе нет;')
    expect(text).toContain('— Docker: 7 260 вакансий, в программе на базовом уровне.')
    expect(text).toContain('Мы уже работаем с вами по программе «Информационная безопасность» (продукт «Киберполигон»)')
    expect(text).toContain('Предлагаем встретиться')
    expect(text.endsWith('С уважением,\nИТ-Школа РТК')).toBe(true)
  })

  it('промпт: персональные данные из фактов вычищаются, названия остаются', () => {
    const redact = createRedactor({ staff: [], contacts: ['Савельева Ольга Викторовна'] }, ['СПбГУТ', 'Программная инженерия'])
    const prompt = buildProductOfferPrompt({ ...FACTS, existing: 'по программе «Программная инженерия», пишите Савельевой О. В. на olga@spbgut.ru' }, redact)
    expect(prompt.kind).toBe('product-offer-letter')
    expect(prompt.user).not.toContain('Савельев')
    expect(prompt.user).not.toContain('olga@spbgut.ru')
    expect(prompt.user).toContain('СПбГУТ')
    expect(prompt.template).not.toContain('olga@spbgut.ru')
    expect(prompt.accepts('Тема: …\n\nУважаемые коллеги!\n\nС уважением,\nИТ-Школа РТК')).toBe(true)
    expect(prompt.accepts('Тема: …')).toBe(false)
  })

  it('переделка письма-предложения — тот же конвейер, что у писем по задаче', () => {
    const redact = createRedactor({ staff: [], contacts: [] })
    const prompt = buildRewritePrompt({ kind: 'product-offer-letter', text: productOfferTemplate(FACTS), style: 'shorter' }, redact)
    expect(prompt.kind).toBe('product-offer-letter')
    expect(prompt.masked).toBe(false)
  })

  it('маска имени: первая буква фамилии и инициалы', () => {
    expect(maskPersonName('Савельева Ольга Викторовна')).toBe('С******** О. В.')
    expect(maskPersonName('Ли')).toBe('Л*')
    expect(maskPersonName('  ')).toBeNull()
  })

  it('цель переделки — пара «программа × продукт» туда и обратно', () => {
    const id = productOfferTargetId('p1', 'cloud')
    expect(parseProductOfferTargetId(id)).toEqual({ programId: 'p1', productId: 'cloud' })
    expect(parseProductOfferTargetId('p1')).toBeNull()
    expect(parseProductOfferTargetId('a:b:c')).toBeNull()
  })
})
