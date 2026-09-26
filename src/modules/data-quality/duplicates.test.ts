import { describe, expect, it } from 'vitest'
import {
  BLOCKING_KEYS,
  blockingPairs,
  findPairs,
  fuzzyWordJaccard,
  pairKey,
  scoreProducts,
  scorePrograms,
  scoreSkills,
  scoreUniversities,
  textScore,
  type SkillCandidate,
  type UniversityCandidate,
} from './duplicates.rules'

const university = (id: string, name: string, city: string, extra: Partial<UniversityCandidate> = {}): UniversityCandidate => ({
  id,
  name,
  city,
  shortName: null,
  inn: null,
  ...extra,
})

const skill = (id: string, name: string, category = 'Разное'): SkillCandidate => ({ id, name, category })

/** Фикстура справочника вузов: два настоящих дубля и несколько «похожих, но разных». */
const UNIVERSITIES = [
  university('u1', 'Уральский федеральный университет', 'Екатеринбург', { shortName: 'УрФУ' }),
  university('u2', 'Уральский федеральный университет имени первого Президента России Б.Н. Ельцина', 'Екатеринбург'),
  university('u3', 'Новосибирский государственный технический университет', 'Новосибирск', { shortName: 'НГТУ' }),
  university('u4', 'Новосибирский гос. технический ун-т', 'Новосибирск'),
  university('u5', 'Донской государственный технический университет', 'Ростов-на-Дону', { shortName: 'ДГТУ' }),
  university('u6', 'Нижегородский государственный технический университет', 'Нижний Новгород', { shortName: 'НГТУ' }),
  university('u7', 'Московский государственный университет', 'Москва'),
  university('u8', 'Московский педагогический государственный университет', 'Москва'),
  university('u9', 'МТУСИ', 'Москва'),
  university('ua', 'Московский технический университет связи и информатики', 'Москва'),
]

const SKILLS = [
  skill('s01', 'JavaScript', 'Языки программирования'),
  skill('s02', 'JS', 'Языки программирования'),
  skill('s03', 'Java', 'Языки программирования'),
  skill('s04', 'PostgreSQL', 'Базы данных'),
  skill('s05', 'Postgres', 'Базы данных'),
  skill('s06', 'SQL', 'Базы данных'),
  skill('s07', 'Kubernetes', 'DevOps'),
  skill('s08', 'K8s', 'DevOps'),
  skill('s09', 'Python', 'Языки программирования'),
  skill('s10', 'Pyhton', 'Языки программирования'),
  skill('s11', 'Linux', 'Системное администрирование'),
  skill('s12', 'Docker', 'DevOps'),
]

const pairsOf = <T extends { id: string }>(found: Array<{ a: T; b: T }>) => found.map((pair) => `${pair.a.id}-${pair.b.id}`)

describe('дубли вузов на фикстуре', () => {
  const found = findPairs(UNIVERSITIES, scoreUniversities, { threshold: 0.4 })

  it('находит ровно три настоящих дубля', () => {
    expect(pairsOf(found).sort()).toEqual(['u1-u2', 'u3-u4', 'u9-ua'])
  })

  it('«имени …» у одного из пары не мешает: значимая часть совпала', () => {
    const pair = found.find((item) => item.a.id === 'u1')!
    expect(pair.score).toBe(1)
    expect(pair.reasons).toContain('Один город: Екатеринбург')
  })

  it('сокращения «гос.» и «ун-т» раскрываются — дубль по словарю', () => {
    const pair = found.find((item) => item.a.id === 'u3')!
    expect(pair).toMatchObject({ method: 'abbreviation', score: 0.95 })
  })

  it('аббревиатура из словаря совпала с полным названием', () => {
    expect(found.find((item) => item.a.id === 'u9')).toMatchObject({ method: 'abbreviation' })
  })

  it('«… государственный технический университет» разных городов — не дубли', () => {
    expect(scoreUniversities(UNIVERSITIES[2]!, UNIVERSITIES[4]!)!.score).toBeLessThan(0.4)
  })

  it('одинаковая аббревиатура НГТУ в разных городах — не дубль: аббревиатура засчитывается только в одном городе', () => {
    const result = scoreUniversities(UNIVERSITIES[2]!, UNIVERSITIES[5]!)!
    expect(result.method).not.toBe('abbreviation')
    expect(result.score).toBeLessThan(0.4)
    expect(result.reasons).toContain('Разные города: Новосибирск и Нижний Новгород')
  })

  it('МГУ и МПГУ — разные вузы: «педагогический» есть только у одного', () => {
    expect(scoreUniversities(UNIVERSITIES[6]!, UNIVERSITIES[7]!)!.score).toBeLessThan(0.4)
  })

  it('совпал ИНН — дубль наверняка, разный ИНН — не дубль вовсе', () => {
    const a = university('x1', 'Первый', 'Москва', { inn: '7707083893' })
    expect(scoreUniversities(a, university('x2', 'Совсем другой', 'Казань', { inn: '7707083893' }))).toMatchObject({
      score: 1,
      method: 'inn',
    })
    expect(scoreUniversities(a, university('x3', 'Первый', 'Москва', { inn: '7736207543' }))).toBeNull()
  })

  it('разное «имени …» у одинаковой значимой части — тёзки, сходство вдвое меньше', () => {
    const result = scoreUniversities(
      university('m1', 'Технический университет имени Баумана', 'Москва'),
      university('m2', 'Технический университет имени Ломоносова', 'Москва'),
    )!
    expect(result.score).toBe(0.5)
    expect(result.reasons.some((reason) => reason.startsWith('Разное «имени …»'))).toBe(true)
  })

  it('оценка симметрична', () => {
    for (const [a, b] of [[0, 1], [2, 3], [6, 7], [2, 5]] as const) {
      expect(scoreUniversities(UNIVERSITIES[a]!, UNIVERSITIES[b]!)!.score).toBe(
        scoreUniversities(UNIVERSITIES[b]!, UNIVERSITIES[a]!)!.score,
      )
    }
  })
})

describe('дубли навыков на фикстуре', () => {
  const found = findPairs(SKILLS, scoreSkills, { threshold: 0.4 })

  it('синонимы и опечатка найдены, «Java» — не «JavaScript», «SQL» — не «PostgreSQL»', () => {
    expect(pairsOf(found).sort()).toEqual(['s01-s02', 's04-s05', 's07-s08', 's09-s10'])
  })

  it('синоним — метод synonym и 0.95, опечатка — levenshtein', () => {
    expect(found.find((pair) => pair.a.id === 's01')).toMatchObject({ method: 'synonym', score: 0.95 })
    expect(found.find((pair) => pair.a.id === 's09')).toMatchObject({ method: 'levenshtein', score: 0.833 })
  })

  it('причины называют категорию', () => {
    expect(found.find((pair) => pair.a.id === 's04')!.reasons).toContain('Одна категория: Базы данных')
  })

  it('совпадение без пробелов и точек — normalized', () => {
    expect(scoreSkills(skill('a', 'Node JS'), skill('b', 'NodeJS'))).toMatchObject({ method: 'synonym' })
    expect(scoreSkills(skill('a', 'Бизнес-анализ'), skill('b', 'Бизнес анализ'))).toMatchObject({
      method: 'normalized',
      score: 1,
    })
  })

  it('порог — параметр: ниже порога пара не попадает', () => {
    expect(findPairs(SKILLS, scoreSkills, { threshold: 0.96 })).toEqual([])
  })

  it('пары отсортированы по убыванию сходства, внутри пары — меньший id первым', () => {
    for (let index = 1; index < found.length; index += 1) {
      expect(found[index - 1]!.score).toBeGreaterThanOrEqual(found[index]!.score)
    }
    for (const pair of found) expect(pair.a.id < pair.b.id).toBe(true)
  })
})

describe('программы и продукты', () => {
  const program = (id: string, name: string, universityId: string, level = 'BACHELOR', code: string | null = null) => ({
    id,
    name,
    code,
    level,
    universityId,
    universityName: universityId,
  })

  it('программы разных вузов с одним названием — не дубли', () => {
    expect(scorePrograms(program('p1', 'Программная инженерия', 'A'), program('p2', 'Программная инженерия', 'B'))).toBeNull()
  })

  it('программы одного вуза: одинаковое название — 1, разный уровень — × 0.8', () => {
    expect(scorePrograms(program('p1', 'Программная инженерия', 'A'), program('p2', 'программная  инженерия', 'A'))!.score).toBe(1)
    expect(
      scorePrograms(program('p1', 'Программная инженерия', 'A'), program('p2', 'Программная инженерия', 'A', 'MASTER'))!.score,
    ).toBe(0.8)
  })

  it('код направления попадает в причины', () => {
    const result = scorePrograms(
      program('p1', 'Программная инженерия', 'A', 'BACHELOR', '09.03.04'),
      program('p2', 'Программная инженерия (очно)', 'A', 'BACHELOR', '09.03.04'),
    )!
    expect(result.reasons).toContain('Совпадает код 09.03.04')
  })

  it('продукты — по названию, с категорией в причинах', () => {
    const result = scoreProducts(
      { id: 'a', name: 'Облачная платформа РТК', category: 'Облако' },
      { id: 'b', name: 'Облачная платформа «РТК»', category: 'Облако' },
    )
    expect(result).toMatchObject({ score: 1, method: 'normalized' })
  })
})

describe('служебное', () => {
  it('ключ пары не зависит от порядка', () => {
    expect(pairKey('b', 'a')).toEqual(['a', 'b'])
    expect(pairKey('a', 'b')).toEqual(['a', 'b'])
  })

  it('общие слова с допуском на опечатку', () => {
    expect(fuzzyWordJaccard(['уральский'], ['уральскии'])).toBe(1)
    expect(fuzzyWordJaccard(['новосибирский', 'технический'], ['донской', 'технический'])).toBeCloseTo(1 / 3, 6)
    expect(fuzzyWordJaccard([], ['a'])).toBe(0)
  })

  it('короткие строки: одна правка до 6 знаков, длиннее — не больше двух', () => {
    expect(textScore('docker', 'dokcer').method).toBe('levenshtein')
    expect(textScore('java', 'jira').method).toBe('trigram')
  })

  it('кандидаты от базы: сравниваются только они, повторы и неизвестные id отброшены', () => {
    const found = findPairs(SKILLS, scoreSkills, {
      threshold: 0.4,
      candidates: [['s02', 's01'], ['s01', 's02'], ['s01', 'нет'], ['s09', 's09']],
    })
    expect(pairsOf(found)).toEqual(['s01-s02'])
  })

  it('блокировка по ключам находит синонимы, которых не видят триграммы', () => {
    const pairs = blockingPairs(SKILLS, BLOCKING_KEYS.skill)
    expect(pairs).toContainEqual(['s01', 's02'])
    expect(pairs).toContainEqual(['s07', 's08'])
    expect(blockingPairs(UNIVERSITIES, BLOCKING_KEYS.university)).toContainEqual(['u3', 'u4'])
  })
})
