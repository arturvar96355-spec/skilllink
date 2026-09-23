import { describe, expect, it } from 'vitest'
import { closeTopLayer, pushEscapeLayer } from './escape-stack'

describe('Escape закрывает только верхний слой', () => {
  it('список внутри окна закрывается раньше окна', () => {
    const closed: string[] = []
    const removeModal = pushEscapeLayer(() => closed.push('окно'))
    const removeSelect = pushEscapeLayer(() => closed.push('список'))

    closeTopLayer()
    expect(closed).toEqual(['список'])

    // Список закрылся и убрал свой слой — следующий Escape достаётся окну.
    removeSelect()
    closeTopLayer()
    expect(closed).toEqual(['список', 'окно'])

    removeModal()
    expect(closeTopLayer()).toBe(false)
  })

  it('слой, убранный не по порядку, не ломает стопку', () => {
    const closed: string[] = []
    const removeFirst = pushEscapeLayer(() => closed.push('первый'))
    const removeSecond = pushEscapeLayer(() => closed.push('второй'))

    removeFirst()
    closeTopLayer()
    expect(closed).toEqual(['второй'])

    removeSecond()
    expect(closeTopLayer()).toBe(false)
  })
})
