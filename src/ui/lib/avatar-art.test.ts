import { describe, expect, it } from 'vitest'
import { AVATAR_TONES, avatarArt, hashSeed, presentationOf } from './avatar-art'

/**
 * Сгенерированный портрет сотрудника (решение 230): один человек — одно лицо на всех
 * экранах и после перезагрузки, разные люди — разные лица, ничего случайного.
 */
describe('сгенерированный аватар', () => {
  const ids = Array.from({ length: 60 }, (_, index) => `cmg${index.toString(36)}user${index * 7}`)

  it('детерминирован: тот же идентификатор — тот же рисунок, до последней линии', () => {
    for (const id of ids) {
      expect(avatarArt(id, 'Иванова Мария Сергеевна')).toEqual(avatarArt(id, 'Иванова Мария Сергеевна'))
    }
  })

  it('держится на идентификаторе, а не на имени: поменяли ФИО — лицо и цвет прежние', () => {
    const before = avatarArt('user-42', 'Кириллов Пётр Андреевич')
    const after = avatarArt('user-42', 'Кириллов Пётр Алексеевич')
    expect(after.tone).toBe(before.tone)
    expect(after.traits).toEqual(before.traits)
  })

  it('хеш — известное значение FNV-1a: одинаков в браузере и на сервере', () => {
    expect(hashSeed('')).toBe(0x811c9dc5)
    expect(hashSeed('a')).toBe(0xe40c292c)
    expect(hashSeed('foobar')).toBe(0xbf9cf968)
  })

  it('разные люди выглядят по-разному: почти все сочетания деталей не повторяются', () => {
    const faces = new Set(ids.map((id) => JSON.stringify(avatarArt(id).traits)))
    expect(faces.size).toBeGreaterThanOrEqual(ids.length - 2)
  })

  it('задействует все тона подложки — цвет не залипает на одном', () => {
    const tones = new Set(ids.map((id) => avatarArt(id).tone))
    expect([...tones].sort()).toEqual([...AVATAR_TONES].sort())
  })

  it('у сотрудниц не бывает бороды', () => {
    for (const id of ids) {
      expect(avatarArt(id, 'Смирнова Ольга Викторовна').traits.beard).toBe('none')
      expect(avatarArt(id, 'Эксперт — менеджер').traits.beard).toBe('none')
    }
  })

  it('отчество читается как подсказка, без отчества — «не знаем»', () => {
    expect(presentationOf('Смирнова Ольга Викторовна')).toBe('female')
    expect(presentationOf('Иванов Илья Ильич')).toBe('male')
    expect(presentationOf('Орлов Денис Павлович')).toBe('male')
    expect(presentationOf('Администратор')).toBe('unknown')
    expect(presentationOf('Эксперт — менеджер')).toBe('unknown')
  })

  it('рисунок не выходит за холст 64×64 — ничего не обрезается у края', () => {
    for (const id of ids) {
      for (const shape of avatarArt(id, 'Петров Алексей Иванович').shapes) {
        const numbers =
          shape.type === 'path'
            ? (shape.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
            : shape.type === 'rect'
              ? [shape.x, shape.y, shape.x + shape.width, shape.y + shape.height]
              : shape.type === 'circle'
                ? [shape.cx - shape.r, shape.cy - shape.r, shape.cx + shape.r, shape.cy + shape.r]
                : [shape.cx - shape.rx, shape.cy - shape.ry, shape.cx + shape.rx, shape.cy + shape.ry]
        for (const value of numbers) {
          expect(value).toBeGreaterThanOrEqual(0)
          expect(value).toBeLessThanOrEqual(64)
        }
      }
    }
  })
})
