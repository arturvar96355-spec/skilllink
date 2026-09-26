import { describe, expect, it } from 'vitest'
import { tryParseAnalysis } from './inbound-letters.prompts'

describe('tryParseAnalysis: ответ модели проверяется схемой (решение 170)', () => {
  it('корректный JSON проходит', () => {
    const parsed = tryParseAnalysis('{"group": "MEETING", "action": "Согласовать время", "confidence": 0.8, "quotes": ["Давайте встретимся"]}')
    expect(parsed).toEqual({ group: 'MEETING', action: 'Согласовать время', confidence: 0.8, quotes: ['Давайте встретимся'] })
  })

  it('JSON, обёрнутый пояснением модели вокруг, — тоже проходит', () => {
    const parsed = tryParseAnalysis(
      'Вот разбор:\n{"group": "QUESTION", "action": "Ответить на вопрос", "confidence": 0.5, "quotes": []}\nНадеюсь, помогло.',
    )
    expect(parsed?.group).toBe('QUESTION')
  })

  it('неизвестная группа — отклонено', () => {
    expect(tryParseAnalysis('{"group": "SPAM", "action": "x", "confidence": 0.5, "quotes": []}')).toBeNull()
  })

  it('уверенность вне диапазона 0..1 — отклонено', () => {
    expect(tryParseAnalysis('{"group": "OTHER", "action": "x", "confidence": 1.5, "quotes": []}')).toBeNull()
  })

  it('пустое действие — отклонено', () => {
    expect(tryParseAnalysis('{"group": "OTHER", "action": "", "confidence": 0.5, "quotes": []}')).toBeNull()
  })

  it('не JSON вовсе — отклонено, без исключения', () => {
    expect(tryParseAnalysis('это не json')).toBeNull()
  })

  it('пустая строка — отклонено', () => {
    expect(tryParseAnalysis('')).toBeNull()
  })
})
