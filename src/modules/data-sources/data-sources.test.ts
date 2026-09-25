import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { UserRole } from '@/shared/contracts/enums'
import { status } from './data-sources.service'

/**
 * Статус ИИ-помощника во вкладке «Интеграции»: провайдер, модель, готовность —
 * и ни ключа, ни его фрагмента, ни идентификатора каталога.
 */

const TOUCHED = [
  'AI_ASSIST_PROVIDER',
  'YANDEX_GPT_API_KEY',
  'YANDEX_FOLDER_ID',
  'YANDEX_GPT_MODEL',
  'GIGACHAT_AUTH_KEY',
  'GIGACHAT_MODEL',
]

const YANDEX_KEY = 'AQVN7q2ZkP9xW4mR8tL3vB6nC1dF5hJ0'
const FOLDER = 'b1g9h4k2m7p5r3s8'
const GIGACHAT_KEY = 'ZmFrZS1naWdhY2hhdC1hdXRoLWtleQ=='

let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = Object.fromEntries(TOUCHED.map((name) => [name, process.env[name]]))
  for (const name of TOUCHED) delete process.env[name]
})

afterEach(() => {
  for (const name of TOUCHED) {
    const value = saved[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

const as = (role: UserRole): CurrentUser => ({
  id: 'u1',
  email: 'u1@skilllink.demo',
  fullName: 'Тестовый Пользователь',
  role,
  universityId: null,
})

/** Любые 6 подряд идущих знаков секрета — уже утечка. */
function leaksFragment(text: string, secret: string): boolean {
  for (let start = 0; start + 6 <= secret.length; start += 1) {
    if (text.includes(secret.slice(start, start + 6))) return true
  }
  return false
}

describe('статус ИИ-помощника', () => {
  it('по умолчанию выключен: ответы пишет шаблон', () => {
    const { aiAssist } = status(as('ADMIN'))
    expect(aiAssist).toMatchObject({ provider: 'off', ready: false, model: null })
  })

  it('YandexGPT с ключом и каталогом — готов, модель названа, ключа и каталога в ответе нет', () => {
    process.env.AI_ASSIST_PROVIDER = 'yandexgpt'
    process.env.YANDEX_GPT_API_KEY = YANDEX_KEY
    process.env.YANDEX_FOLDER_ID = FOLDER

    const result = status(as('ANALYST'))
    expect(result.aiAssist).toEqual({
      provider: 'yandexgpt',
      name: 'YandexGPT',
      ready: true,
      model: 'yandexgpt-lite',
      reason: null,
    })
    const text = JSON.stringify(result)
    expect(leaksFragment(text, YANDEX_KEY)).toBe(false)
    expect(leaksFragment(text, FOLDER)).toBe(false)
  })

  it('YandexGPT без каталога — не готов, в причине только имя переменной', () => {
    process.env.AI_ASSIST_PROVIDER = 'yandexgpt'
    process.env.YANDEX_GPT_API_KEY = YANDEX_KEY

    const result = status(as('ADMIN'))
    expect(result.aiAssist.ready).toBe(false)
    expect(result.aiAssist.reason).toBe('Не задано: YANDEX_FOLDER_ID')
    expect(leaksFragment(JSON.stringify(result), YANDEX_KEY)).toBe(false)
  })

  it('GigaChat — ключ авторизации в ответ не попадает', () => {
    process.env.AI_ASSIST_PROVIDER = 'gigachat'
    process.env.GIGACHAT_AUTH_KEY = GIGACHAT_KEY

    const result = status(as('ADMIN'))
    expect(result.aiAssist).toMatchObject({ provider: 'gigachat', ready: true, model: 'GigaChat' })
    expect(leaksFragment(JSON.stringify(result), GIGACHAT_KEY)).toBe(false)
  })

  it('прежние поля ответа на месте', () => {
    const result = status(as('ADMIN'))
    expect(Object.keys(result)).toEqual(
      expect.arrayContaining(['marketDataProvider', 'integrations', 'checkedAt', 'aiAssist']),
    )
    expect(result.integrations.map((item) => item.key)).toEqual(['market-data', 'lms', 'site'])
  })

  it('представителю вуза состояние интеграций закрыто', () => {
    expect(() => status(as('UNIVERSITY_REP'))).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }))
  })
})
