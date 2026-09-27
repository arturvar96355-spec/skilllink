import { describe, expect, it } from 'vitest'
import {
  addVersion,
  currentVersion,
  editVersion,
  initialVersions,
  resetVersions,
  stepVersion,
} from './draft-versions'

describe('варианты черновика письма (решение 213)', () => {
  it('переделка добавляет вариант и делает его текущим', () => {
    const state = addVersion(initialVersions('Исходный'), 'Короткий', 'shorter')
    expect(state.index).toBe(1)
    expect(currentVersion(state)).toEqual({ text: 'Короткий', style: 'shorter' })
  })

  it('«Прошлый вариант» возвращает прежний текст вместе с правкой человека', () => {
    let state = editVersion(initialVersions('Исходный'), 'Исходный с правкой')
    state = addVersion(state, 'Мягкий', 'softer')
    state = stepVersion(state, -1)
    expect(currentVersion(state).text).toBe('Исходный с правкой')
    expect(stepVersion(state, -1)).toBe(state)
  })

  it('новая переделка из середины отбрасывает варианты после текущего', () => {
    let state = addVersion(initialVersions('A'), 'B', 'shorter')
    state = addVersion(state, 'C', 'softer')
    state = stepVersion(stepVersion(state, -1), -1)
    state = addVersion(state, 'D', 'formal')
    expect(state.list.map((version) => version.text)).toEqual(['A', 'D'])
  })

  it('сохранённая правка не сбрасывает историю, новый черновик — сбрасывает', () => {
    const state = addVersion(initialVersions('A'), 'B', 'shorter')
    expect(resetVersions(state, 'B')).toBe(state)
    expect(resetVersions(state, 'Новый')).toEqual(initialVersions('Новый'))
  })
})
