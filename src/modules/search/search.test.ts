import { describe, expect, it } from 'vitest'
import { cooperationTitle } from './search.service'

describe('связка в глобальном поиске', () => {
  it('подписана кратким именем вуза, как в реестре', () => {
    expect(
      cooperationTitle({
        universityName: 'Санкт-Петербургский государственный университет телекоммуникаций',
        universityShortName: 'СПбГУТ',
        programName: 'Программная инженерия',
      }),
    ).toBe('СПбГУТ — Программная инженерия')
  })

  it('без краткого имени — полное', () => {
    expect(
      cooperationTitle({
        universityName: 'Уральский федеральный университет',
        universityShortName: null,
        programName: 'Компьютерная безопасность',
      }),
    ).toBe('Уральский федеральный университет — Компьютерная безопасность')
  })
})
