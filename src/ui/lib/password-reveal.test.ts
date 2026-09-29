import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { hideRevealedOnSubmit } from './password-reveal'

/**
 * «Глаз» в поле пароля (#261): отправка формы возвращает поле в «скрыто».
 * Документ — заглушка: в Node `EventTarget` не снимает слушатель фазы захвата.
 */
function fakeDocument() {
  const listeners = new Map<(event: Event) => void, unknown>()
  return {
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject | null, options?: unknown) => {
      listeners.set(listener as (event: Event) => void, options)
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject | null) => {
      listeners.delete(listener as (event: Event) => void)
    },
    submit: (form: unknown) => listeners.forEach((_options, listener) => listener({ target: form } as unknown as Event)),
    listeners,
  }
}

describe('показанный пароль при отправке формы', () => {
  it('отправка своей формы скрывает пароль; слушатель — в фазе захвата', () => {
    const page = fakeDocument()
    const form = {}
    const hide = vi.fn()
    hideRevealedOnSubmit(page, () => ({ form }), hide)
    expect([...page.listeners.values()]).toEqual([true])
    page.submit(form)
    expect(hide).toHaveBeenCalledTimes(1)
  })

  it('отправка другой формы и поле вне формы — пароль не трогается', () => {
    const page = fakeDocument()
    const hide = vi.fn()
    hideRevealedOnSubmit(page, () => ({ form: {} }), hide)
    hideRevealedOnSubmit(page, () => ({ form: null }), hide)
    hideRevealedOnSubmit(page, () => null, hide)
    page.submit({})
    expect(hide).not.toHaveBeenCalled()
  })

  it('после отписки слушателя нет', () => {
    const page = fakeDocument()
    const form = {}
    const hide = vi.fn()
    hideRevealedOnSubmit(page, () => ({ form }), hide)()
    page.submit(form)
    expect(hide).not.toHaveBeenCalled()
    expect(page.listeners.size).toBe(0)
  })

  it('общее поле Input подключает сброс, пока пароль показан', () => {
    const input = readFileSync(join(process.cwd(), 'src/ui/primitives/Form.tsx'), 'utf8')
    expect(input).toMatch(/if \(!revealed\) return\s+[^}]*hideRevealedOnSubmit\(document,/)
  })
})
