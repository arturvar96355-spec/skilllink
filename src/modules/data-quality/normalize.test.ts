import { describe, expect, it } from 'vitest'
import {
  compactKey,
  coreWords,
  normalizeSkillName,
  normalizeText,
  normalizeUniversityName,
  universityAcronym,
} from './normalize'

describe('общая нормализация', () => {
  it('нижний регистр, «ё» → «е», кавычки и точки сняты, пробелы свёрнуты', () => {
    expect(normalizeText('  «Лёгкий»   ВУЗ им. Н.Э. Баумана ')).toBe('легкий вуз им н э баумана')
  })

  it('дефис внутри слова остаётся, одиночный дефис — пробел', () => {
    expect(normalizeText('Санкт-Петербургский ун-т — филиал')).toBe('санкт-петербургский ун-т — филиал')
    expect(normalizeText('Python - основы')).toBe('python основы')
  })

  it('C++ и C# не превращаются в «c»', () => {
    expect(normalizeText('C++')).toBe('c++')
    expect(normalizeText('C#')).toBe('c#')
  })

  it('неразрывный пробел и «полноширинные» буквы сводятся NFKC', () => {
    expect(normalizeText('Machine Learning')).toBe('machine learning')
    expect(normalizeText('ＰＹＴＨＯＮ')).toBe('python')
  })

  it('сжатый ключ — без пробелов, точек и дефисов', () => {
    expect(compactKey('Java Script')).toBe('javascript')
    expect(compactKey('Node.js')).toBe('nodejs')
    expect(compactKey('CI/CD')).toBe('cicd')
  })
})

describe('названия вузов: сокращения и словарь', () => {
  it('«гос.», «ун-т», «им.» раскрываются', () => {
    expect(normalizeUniversityName('Новосибирский гос. технический ун-т').full).toBe(
      'новосибирский государственный технический университет',
    )
    expect(normalizeUniversityName('Ун-т им. Ломоносова').full).toBe('университет имени ломоносова')
  })

  it('организационно-правовая форма снимается', () => {
    expect(normalizeUniversityName('ФГБОУ ВО «Уральский федеральный университет»').full).toBe(
      'уральский федеральный университет',
    )
    expect(
      normalizeUniversityName(
        'Федеральное государственное автономное образовательное учреждение высшего образования «Уральский федеральный университет»',
      ).full,
    ).toBe('уральский федеральный университет')
  })

  it('аббревиатуры из словаря раскрываются в полное название', () => {
    expect(normalizeUniversityName('МТУСИ').full).toBe('московский технический университет связи и информатики')
    expect(normalizeUniversityName('НИУ ВШЭ').full).toBe('национальный исследовательский университет высшая школа экономики')
    expect(normalizeUniversityName('МГТУ им. Н.Э. Баумана').full).toBe(
      'московский государственный технический университет имени н э баумана',
    )
  })

  it('значимая часть — без типовых слов и «имени …», «имени» — отдельно', () => {
    const name = normalizeUniversityName('Уральский федеральный университет имени первого Президента России Б.Н. Ельцина')
    expect(name.core).toEqual(['уральский'])
    expect(name.honorific).toBe('первого президента россии б н ельцина')
  })

  it('опечатка в типовом слове — всё равно типовое', () => {
    expect(normalizeUniversityName('Уральский федерлаьный универистет').core).toEqual(['уральский'])
  })

  it('слова специализации остаются значимыми: МГУ и МПГУ различаются', () => {
    expect(normalizeUniversityName('Московский педагогический государственный университет').core).toEqual([
      'московский',
      'педагогический',
    ])
  })

  it('город из названия не считается значимой частью', () => {
    const name = normalizeUniversityName('Уральский федеральный университет (Екатеринбург)')
    expect(coreWords(name, ['Екатеринбург'])).toEqual(['уральский'])
  })

  it('аббревиатура из первых букв: «Санкт-Петербургский» → «спб», союз «и» пропускается', () => {
    expect(universityAcronym('санкт-петербургский государственный университет телекоммуникаций')).toBe('спбгут')
    expect(universityAcronym('московский технический университет связи и информатики')).toBe('мтуси')
    expect(universityAcronym('московский государственный университет имени м в ломоносова')).toBe('мгу')
  })
})

describe('названия навыков: словарь синонимов', () => {
  it.each([
    ['JS', 'javascript'],
    ['Java Script', 'javascript'],
    ['TS', 'typescript'],
    ['k8s', 'kubernetes'],
    ['Postgres', 'postgresql'],
    ['PostgreSQL', 'postgresql'],
    ['Golang', 'go'],
    ['1С:Предприятие', '1с'],
    // Латинская «C» в «1C» — тот же навык, что с кириллической «С».
    ['1C', '1с'],
    ['CI/CD', 'ci/cd'],
    ['ML', 'машинное обучение'],
    ['Node.js', 'node'],
  ])('%s → %s', (name, canonical) => {
    expect(normalizeSkillName(name).canonical).toBe(canonical)
  })

  it('словарь сработал — признак bySynonym; само каноническое имя — без признака', () => {
    expect(normalizeSkillName('JS').bySynonym).toBe(true)
    expect(normalizeSkillName('JavaScript').bySynonym).toBe(false)
  })

  it('синоним внутри названия заменяется по слову', () => {
    expect(normalizeSkillName('Vanilla JS').canonical).toBe('vanilla javascript')
  })

  it('незнакомое название остаётся как есть', () => {
    expect(normalizeSkillName('Сетевые технологии')).toEqual({
      text: 'сетевые технологии',
      canonical: 'сетевые технологии',
      bySynonym: false,
    })
  })
})
