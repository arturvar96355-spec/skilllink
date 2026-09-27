import { describe, expect, it } from 'vitest'
import { overdueValue, queueRowLabel, stageNotation, toneOfPriority, toneOfSeverity } from './queue-row'

describe('строка очереди: тон полоски', () => {
  it('красный — только у просрочки; давняя насыщеннее свежей; блокировка фиолетовая', () => {
    expect(toneOfSeverity('overdue-long')).toBe('critical')
    expect(toneOfSeverity('overdue')).toBe('late')
    expect(toneOfSeverity('blocked')).toBe('accent')
  })

  it('приоритет — фиолетовая гамма по силе, красный только у критичного', () => {
    expect(toneOfPriority('CRITICAL')).toBe('critical')
    expect(toneOfPriority('HIGH')).toBe('accent')
    expect(toneOfPriority('MEDIUM')).toBe('accent-soft')
    expect(toneOfPriority('LOW')).toBe('accent-faint')
  })
})

describe('строка очереди: значение справа', () => {
  it('просрочка — «−N дн.» типографским минусом и неразрывным пробелом', () => {
    expect(overdueValue(101)).toEqual({ text: '−101 дн.', tone: 'danger' })
  })

  it('срок вышел сегодня — «сегодня», а не «−0 дн.»', () => {
    expect(overdueValue(0)).toEqual({ text: 'сегодня', tone: 'danger' })
  })

  it('блокировка — «блок» фиолетовым', () => {
    expect(overdueValue(null)).toEqual({ text: 'блок', tone: 'accent' })
  })
})

describe('строка очереди: запись этапа и имя для чтения с экрана', () => {
  it('этап — «06 / 14» с неразрывными пробелами', () => {
    expect(stageNotation(6)).toBe('06 / 14')
    expect(stageNotation(10)).toBe('10 / 14')
  })

  it('имя строки — части через точку, пустые пропущены, лишние точки сняты', () => {
    expect(queueRowLabel(['ДГТУ — Информационная безопасность', null, 'этап 10.', '', false, 'Открыть этап'])).toBe(
      'ДГТУ — Информационная безопасность. этап 10. Открыть этап',
    )
  })
})
