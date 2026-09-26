import { describe, expect, it } from 'vitest'
import { bodyPreview, classifyByRules, defaultActionFor, groupLabel } from './inbound-letters.rules'

describe('classifyByRules: разбор письма без модели (решение 170)', () => {
  it('пауза/отказ — по ключевым словам', () => {
    const result = classifyByRules('Приостанавливаем сотрудничество на этот учебный год.')
    expect(result.group).toBe('PAUSE_OR_REFUSAL')
    expect(result.action).toBe(defaultActionFor('PAUSE_OR_REFUSAL'))
    expect(result.quotes.length).toBeGreaterThan(0)
  })

  it('встреча — предложение созвониться', () => {
    const result = classifyByRules('Предлагаем встретиться и обсудить дальнейшие шаги. Согласуем удобное время.')
    expect(result.group).toBe('MEETING')
  })

  it('документы — просьба выслать договор', () => {
    const result = classifyByRules('Просим выслать оригинал договора и приложения к нему для подписания.')
    expect(result.group).toBe('DOCUMENTS')
  })

  it('сдвиг этапа — учебный план утверждён', () => {
    const result = classifyByRules('Учебный план утверждён, готовы начать занятия по программе.')
    expect(result.group).toBe('STAGE_SHIFT')
  })

  it('вопрос — уточнение по срокам', () => {
    const result = classifyByRules('Подскажите, пожалуйста, когда начнутся занятия? Не совсем понятно из письма.')
    expect(result.group).toBe('QUESTION')
  })

  it('ничего не совпало — группа «Прочее» с низкой уверенностью и без цитат', () => {
    const result = classifyByRules('Добрый день! Хорошего вам дня.')
    expect(result.group).toBe('OTHER')
    expect(result.quotes).toEqual([])
    expect(result.confidence).toBeLessThan(0.3)
  })

  it('несколько признаков одной группы поднимают уверенность, не выше потолка правил', () => {
    const weak = classifyByRules('Предлагаем встретиться.')
    const strong = classifyByRules('Предлагаем встретиться, согласовать удобное время для звонка, обсудить очно детали по зуму.')
    expect(strong.confidence).toBeGreaterThan(weak.confidence)
    expect(strong.confidence).toBeLessThanOrEqual(0.6)
  })

  it('при конкурирующих группах побеждает та, где больше разных ключевых слов', () => {
    // Один признак «документы», два признака «встречи» — встреча должна победить.
    const result = classifyByRules('Просим выслать документы. Предлагаем встретиться и согласовать удобное время.')
    expect(result.group).toBe('MEETING')
  })

  it('повтор одного и того же слова не считается несколькими признаками', () => {
    // «вопрос» трижды — один признак, не три; результат не должен обгонять группу с двумя разными признаками.
    const manyRepeats = classifyByRules('Вопрос, вопрос и ещё раз вопрос.')
    const twoDistinct = classifyByRules('Уточните, пожалуйста, у нас есть вопрос.')
    expect(manyRepeats.group).toBe('QUESTION')
    expect(twoDistinct.confidence).toBeGreaterThanOrEqual(manyRepeats.confidence)
  })
})

describe('groupLabel/defaultActionFor', () => {
  it('подпись и действие есть у каждой из шести групп', () => {
    const groups = ['STAGE_SHIFT', 'DOCUMENTS', 'MEETING', 'QUESTION', 'PAUSE_OR_REFUSAL', 'OTHER'] as const
    for (const group of groups) {
      expect(groupLabel(group).length).toBeGreaterThan(0)
      expect(defaultActionFor(group).length).toBeGreaterThan(0)
    }
  })
})

describe('bodyPreview', () => {
  it('короткий текст не обрезается', () => {
    expect(bodyPreview('Короткое письмо.', 160)).toBe('Короткое письмо.')
  })

  it('длинный текст обрезается по границе слова с многоточием', () => {
    const text = 'Слово '.repeat(50).trim()
    const preview = bodyPreview(text, 30)
    expect(preview.length).toBeLessThanOrEqual(31)
    expect(preview.endsWith('…')).toBe(true)
    expect(preview).not.toMatch(/Сло…$/)
  })

  it('лишние пробелы и переносы строк схлопываются', () => {
    expect(bodyPreview('Привет,\n\n  мир', 160)).toBe('Привет, мир')
  })
})
