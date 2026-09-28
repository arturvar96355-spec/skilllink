import type { ProductRecommendationDto } from '@/shared/contracts/product-recommendation'
import type { SkillLevel } from '@/shared/contracts/enums'
import { countWithNoun, plural } from '@/shared/utils/text'
import { isVacancyUnit } from '@/modules/recommendations/product-match.rules'

/**
 * Письмо вузу с предложением IT-продукта (решение 223): факты для модели и тот же
 * текст шаблоном. Что предложить и почему — посчитали правила рекомендаций продуктов
 * (`product-match.rules.ts`); здесь только слова.
 *
 * Ни имени, ни должности, ни почты получателя в фактах нет: «кому» — вуз и слова
 * «основной контакт», имя сотрудник подставит сам. Маска имени — только для экрана.
 */

/** Сколько дефицитных навыков называть в письме: дальше письмо превращается в таблицу. */
const LETTER_SKILLS = 3

const LEVEL_IN_PROGRAM: Record<SkillLevel, string> = {
  BASIC: 'в программе на базовом уровне',
  INTERMEDIATE: 'в программе на среднем уровне',
  ADVANCED: 'в программе на продвинутом уровне',
}

export interface ProductOfferSkillFact {
  name: string
  /** «1 240 вакансий» или «73 (единица)». */
  amount: string
  demand: number
  inProgram: string
}

export interface ProductOfferFacts {
  universityName: string
  programName: string
  productName: string
  period: string | null
  skills: ProductOfferSkillFact[]
  /** Сколько ещё дефицитных навыков закрывает продукт сверх названных. */
  moreSkills: number
  /** Все навыки продукта — «что даёт продукт». */
  productSkills: string[]
  /** «по программе «Информатика» (продукт «Учебная СУБД»)» — уже работаем; null — не работаем. */
  existing: string | null
}

function amountOf(value: number, unit: string): string {
  const rounded = Math.round(value)
  const number = new Intl.NumberFormat('ru-RU').format(rounded).replace(/\u00a0/g, ' ')
  return isVacancyUnit(unit) ? `${number} ${plural(rounded, ['вакансия', 'вакансии', 'вакансий'])}` : `${number} ${unit}`
}

export function productOfferFacts(input: {
  recommendation: ProductRecommendationDto
  productSkills: readonly string[]
  period: string | null
  existing: { programName: string; productName: string } | null
}): ProductOfferFacts {
  const { recommendation } = input
  // В письмо — навыки в профиле направления: «вне профиля» — внутренняя оговорка, вузу она ни к чему.
  const relevant = recommendation.closes.filter((skill) => !skill.outOfProfile)
  const listed = (relevant.length > 0 ? relevant : recommendation.closes).slice(0, LETTER_SKILLS)
  return {
    universityName: recommendation.program.universityName,
    programName: recommendation.program.name,
    productName: recommendation.product.name,
    period: input.period,
    skills: listed.map((skill) => ({
      name: skill.name,
      amount: amountOf(skill.demandValue, skill.demandUnit),
      demand: skill.demand,
      inProgram: skill.level ? LEVEL_IN_PROGRAM[skill.level] : 'в программе нет',
    })),
    moreSkills: Math.max(0, (relevant.length > 0 ? relevant.length : recommendation.closes.length) - listed.length),
    productSkills: [...input.productSkills],
    existing: input.existing
      ? `по программе «${input.existing.programName}» (продукт «${input.existing.productName}»)`
      : null,
  }
}

function moreSkillsText(count: number): string {
  return countWithNoun(count, ['навык', 'навыка', 'навыков'])
}

function periodText(period: string | null): string {
  if (!period) return 'за последний период'
  const quarter = /^(\d{4})-Q([1-4])$/.exec(period)
  if (quarter) return `за ${quarter[2]}-й квартал ${quarter[1]} года`
  return `за период ${period}`
}

export function productOfferSubject(facts: Pick<ProductOfferFacts, 'productName' | 'programName'>): string {
  return `IT-продукт «${facts.productName}» для программы «${facts.programName}»`
}

export function productOfferLines(facts: ProductOfferFacts): string[] {
  const skills = facts.skills
    .map((skill) => `${skill.name} — ${skill.amount}, спрос ${skill.demand} из 100, ${skill.inProgram}`)
    .join('; ')
  return [
    'Отправитель: ИТ-Школа РТК',
    `Получатель: представитель вуза ${facts.universityName} — основной контакт; имя и должность не указывать`,
    `Тема: ${productOfferSubject(facts)}`,
    `Чего не хватает программе «${facts.programName}» по спросу работодателей ${periodText(facts.period)}: ${skills}` +
      (facts.moreSkills > 0 ? `; и ещё ${moreSkillsText(facts.moreSkills)}` : ''),
    `Что даёт продукт «${facts.productName}» ИТ-Школы РТК: навыки ${facts.productSkills.join(', ')}`,
    `Уже работаем с вузом: ${facts.existing ?? 'нет'}`,
    'Что предлагаем: встречу — рассказать о продукте и обсудить, как он может войти в программу; дату не называть',
  ]
}

/** Письмо без модели: те же факты, вежливо и коротко. */
export function productOfferTemplate(facts: ProductOfferFacts): string {
  const skillLines = facts.skills.map((skill) => `— ${skill.name}: ${skill.amount}, ${skill.inProgram};`)
  if (skillLines.length > 0) {
    const last = skillLines.length - 1
    skillLines[last] = skillLines[last]!.replace(/;$/, facts.moreSkills > 0 ? `; и ещё ${moreSkillsText(facts.moreSkills)}.` : '.')
  }
  return [
    `Тема: ${productOfferSubject(facts)}`,
    '',
    'Уважаемые коллеги!',
    '',
    `Мы посмотрели спрос работодателей ${periodText(facts.period)} на навыки, которым учит программа «${facts.programName}». ` +
      'Чаще всего работодатели ищут навыки, которых в программе пока нет или которые даются на начальном уровне:',
    ...skillLines,
    '',
    `Продукт ИТ-Школы РТК «${facts.productName}» даёт навыки: ${facts.productSkills.join(', ')}.` +
      (facts.existing ? ` Мы уже работаем с вами ${facts.existing} — будем рады расширить сотрудничество.` : ''),
    '',
    `Предлагаем встретиться: расскажем о продукте и обсудим, как он может войти в программу «${facts.programName}». ` +
      'Подскажите, пожалуйста, удобное для вас время.',
    '',
    'С уважением,',
    'ИТ-Школа РТК',
  ].join('\n')
}

/**
 * Маска ФИО для экрана: «Савельева Ольга Викторовна» → «С******** О. В.». Сколько
 * звёздочек — столько скрытых букв фамилии; имя и отчество — инициалами.
 */
export function maskPersonName(fullName: string): string | null {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  const [surname, ...rest] = parts
  if (!surname) return null
  const initials = rest.map((part) => `${part.charAt(0).toUpperCase()}.`).join(' ')
  return `${surname.charAt(0).toUpperCase()}${'*'.repeat(Math.max(1, surname.length - 1))}${initials ? ` ${initials}` : ''}`
}
