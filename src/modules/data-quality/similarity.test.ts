import { describe, expect, it } from 'vitest'
import { editDistance, editSimilarity, jaccard, levenshtein, trigramSimilarity, trigrams, trigramWords } from './similarity'

describe('триграммы как в pg_trgm', () => {
  it('слово дополняется двумя пробелами слева и одним справа', () => {
    expect([...trigrams('кот')].sort()).toEqual(['  к', ' ко', 'кот', 'от '].sort())
  })

  it('однобуквенное слово — две триграммы', () => {
    expect([...trigrams('a')].sort()).toEqual(['  a', ' a '])
  })

  it('регистр не важен, знаки препинания разделяют слова, повторы не считаются', () => {
    expect(trigrams('Кот, КОТ!')).toEqual(trigrams('кот'))
    expect(trigramWords('Java-Script (ES6)')).toEqual(['java', 'script', 'es6'])
  })

  it('ручной пример: «кот» и «кит» — 1 общая из 7', () => {
    // кот: «  к», « ко», «кот», «от »; кит: «  к», « ки», «кит», «ит ».
    // Общая только «  к»; объединение 4 + 4 − 1 = 7.
    expect(trigramSimilarity('кот', 'кит')).toBeCloseTo(1 / 7, 6)
  })

  it('ручной пример: «python» и «pyhton» — 3 из 11', () => {
    // python: «  p», « py», «pyt», «yth», «tho», «hon», «on »
    // pyhton: «  p», « py», «pyh», «yht», «hto», «ton», «on »
    // общие: «  p», « py», «on » → 3; объединение 7 + 7 − 3 = 11.
    expect(trigramSimilarity('python', 'pyhton')).toBeCloseTo(3 / 11, 6)
  })

  it('совпадает с similarity() PostgreSQL на проверенных запросом примерах', () => {
    // SELECT similarity('московский университет', 'москва университет') → 0.61538464
    expect(trigramSimilarity('московский университет', 'москва университет')).toBeCloseTo(0.61538464, 6)
    // SELECT similarity('javascript', 'java script') → 0.64285713
    expect(trigramSimilarity('javascript', 'java script')).toBeCloseTo(0.64285713, 6)
    // SELECT similarity('Уральский федеральный', 'уральский федеральный университет') → 0.6451613
    expect(trigramSimilarity('Уральский федеральный', 'уральский федеральный университет')).toBeCloseTo(0.6451613, 6)
  })

  it('одинаковые — 1, пустая строка ни на что не похожа', () => {
    expect(trigramSimilarity('Docker', 'docker')).toBe(1)
    expect(trigramSimilarity('', '')).toBe(0)
    expect(trigramSimilarity('', 'docker')).toBe(0)
  })

  it('симметрично', () => {
    expect(trigramSimilarity('Kubernetes', 'Kubernetis')).toBe(trigramSimilarity('Kubernetis', 'Kubernetes'))
  })

  it('Жаккар пустых множеств — 0', () => {
    expect(jaccard(new Set(), new Set())).toBe(0)
  })
})

describe('Левенштейн', () => {
  it.each([
    ['kitten', 'sitting', 3],
    ['', 'abc', 3],
    ['abc', '', 3],
    ['docker', 'docker', 0],
    ['доцент', 'доцнет', 2],
    ['flaw', 'lawn', 2],
  ])('%s → %s: %d', (left, right, distance) => {
    expect(levenshtein(left, right)).toBe(distance)
    expect(levenshtein(right, left)).toBe(distance)
  })

  it('перестановка соседних знаков — одна правка в варианте с перестановками', () => {
    expect(levenshtein('python', 'pyhton')).toBe(2)
    expect(editDistance('python', 'pyhton')).toBe(1)
    expect(editDistance('доцент', 'доцнет')).toBe(1)
  })

  it('считает по кодовым точкам, а не по половинкам UTF-16', () => {
    expect(levenshtein('a😀', 'a😃')).toBe(1)
  })

  it('сходство по правкам: 1 − правки / длина большей', () => {
    expect(editSimilarity('python', 'pyhton')).toBeCloseTo(1 - 1 / 6, 6)
    expect(editSimilarity('', '')).toBe(0)
  })
})
