import { describe, expect, it } from 'vitest'
import { plural, pluralize, PROGRAM_FORMS, PROGRAM_FORMS_OF } from './text'

describe('склонение при числе', () => {
  it('единственное число', () => {
    expect(plural(1, PROGRAM_FORMS)).toBe('программа')
    expect(plural(21, PROGRAM_FORMS)).toBe('программа')
    expect(plural(101, PROGRAM_FORMS)).toBe('программа')
  })

  it('от двух до четырёх', () => {
    for (const count of [2, 3, 4, 22, 33, 104]) {
      expect(plural(count, PROGRAM_FORMS)).toBe('программы')
    }
  })

  it('множественное число', () => {
    for (const count of [0, 5, 9, 25, 100, 1000]) {
      expect(plural(count, PROGRAM_FORMS)).toBe('программ')
    }
  })

  it('исключение — от одиннадцати до девятнадцати', () => {
    // Главная ловушка: 11 и 111 оканчиваются на 1, но склоняются как «программ».
    for (const count of [11, 12, 14, 19, 111, 112, 114]) {
      expect(plural(count, PROGRAM_FORMS)).toBe('программ')
    }
  })

  it('число подставляется вместе со словом', () => {
    expect(pluralize(1, PROGRAM_FORMS)).toBe('1 программа')
    expect(pluralize(5, PROGRAM_FORMS)).toBe('5 программ')
  })

  it('после «из» падеж другой', () => {
    // «учтено 1 из 1 программы», а не «из 1 программа».
    expect(`из ${pluralize(1, PROGRAM_FORMS_OF)}`).toBe('из 1 программы')
    expect(`из ${pluralize(2, PROGRAM_FORMS_OF)}`).toBe('из 2 программ')
    expect(`из ${pluralize(21, PROGRAM_FORMS_OF)}`).toBe('из 21 программы')
    expect(`из ${pluralize(11, PROGRAM_FORMS_OF)}`).toBe('из 11 программ')
  })
})
