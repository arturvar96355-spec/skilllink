import { describe, expect, it } from 'vitest'
import { findSimilar, tokenize } from './inbound-letters.similarity'

describe('tokenize', () => {
  it('приводит к нижнему регистру и убирает стоп-слова и короткие слова', () => {
    expect(tokenize('Мы и вы согласуем встречу по проекту')).toEqual(['согласуем', 'встречу', 'проекту'])
  })

  it('цифры и латиница тоже считаются словами', () => {
    expect(tokenize('Договор №42 от 2026 года IT-продукт')).toEqual(
      expect.arrayContaining(['договор', '2026', 'года', 'продукт']),
    )
  })
})

describe('findSimilar: похожие письма без внешних зависимостей (решение 170)', () => {
  const candidates = [
    { id: 'a', text: 'Просим согласовать время встречи по проекту программной инженерии.' },
    { id: 'b', text: 'Приостанавливаем сотрудничество на этот учебный год, вернёмся позже.' },
    { id: 'c', text: 'Просьба выслать подписанный договор и приложения к нему.' },
  ]

  it('находит письмо, ближе всего по словам к запросу', () => {
    const matches = findSimilar('Предлагаем встретиться и согласовать время встречи по программе.', candidates, 3)
    expect(matches[0]?.id).toBe('a')
  })

  it('ограничивает число результатов', () => {
    const matches = findSimilar('договор приложения подписать выслать', candidates, 1)
    expect(matches).toHaveLength(1)
  })

  it('пустой текст или пустой корпус — пустой результат', () => {
    expect(findSimilar('', candidates, 3)).toEqual([])
    expect(findSimilar('текст без совпадений вообще', [], 3)).toEqual([])
  })

  it('совсем непохожий текст не попадает в результат (score > 0 только)', () => {
    const matches = findSimilar('зпщывалджэ рандомный набор несуществующих слов', candidates, 3)
    expect(matches).toEqual([])
  })

  it('результат отсортирован по убыванию сходства', () => {
    const matches = findSimilar('договор приложения подписать выслать оригинал', candidates, 3)
    for (let i = 1; i < matches.length; i += 1) {
      expect(matches[i - 1]!.score).toBeGreaterThanOrEqual(matches[i]!.score)
    }
  })
})
