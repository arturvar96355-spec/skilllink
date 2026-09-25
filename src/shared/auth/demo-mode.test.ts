import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isDemoAuthEnabled } from './demo-mode'

/*
 * Демо-режим — это обход авторизации: вход без пароля по cookie.
 * Поведение по умолчанию важнее удобства, поэтому проверяется отдельно.
 */

/**
 * `NODE_ENV` в типах Node объявлен только на чтение, поэтому и он, и соседняя
 * переменная меняются через defineProperty — присваивание не проходит проверку типов.
 */
const env = process.env as Record<string, string | undefined>

let savedDemo: string | undefined
let savedEnv: string | undefined

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(env, name)
    return
  }
  Object.defineProperty(env, name, { value, configurable: true, writable: true, enumerable: true })
}

const setNodeEnv = (value: string): void => setEnv('NODE_ENV', value)

beforeEach(() => {
  savedDemo = env.DEMO_AUTH_ENABLED
  savedEnv = env.NODE_ENV
  setEnv('DEMO_AUTH_ENABLED', undefined)
})

afterEach(() => {
  setEnv('DEMO_AUTH_ENABLED', savedDemo)
  setEnv('NODE_ENV', savedEnv)
})

describe('демо-режим авторизации', () => {
  it('в разработке включён по умолчанию', () => {
    setNodeEnv('development')
    expect(isDemoAuthEnabled()).toBe(true)
  })

  it('в продакшене выключен по умолчанию', () => {
    setNodeEnv('production')
    expect(isDemoAuthEnabled()).toBe(false)
  })

  it('явное выключение действует и в разработке', () => {
    setNodeEnv('development')
    setEnv('DEMO_AUTH_ENABLED', 'false')
    expect(isDemoAuthEnabled()).toBe(false)
  })

  it('явное включение действует и в продакшене — это осознанный риск', () => {
    setNodeEnv('production')
    setEnv('DEMO_AUTH_ENABLED', 'true')
    expect(isDemoAuthEnabled()).toBe(true)
  })

  it('мусорное значение не включает демо-режим в продакшене', () => {
    setNodeEnv('production')
    setEnv('DEMO_AUTH_ENABLED', 'да')
    expect(isDemoAuthEnabled()).toBe(false)
  })
})
