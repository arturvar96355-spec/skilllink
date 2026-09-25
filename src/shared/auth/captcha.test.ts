import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { LOGIN_CAPTCHA } from '@/shared/config/auth.config'
import {
  createChallenge,
  parseSolution,
  resetCaptcha,
  verifySolution,
  type CaptchaChallenge,
  type CaptchaSolution,
} from './captcha'

const SECRET = 'тестовый-секрет-подписи'
const NOW = 1_700_000_000_000

/** То же, что делает браузер (captcha-search.ts), только синхронно. */
function solve(task: CaptchaChallenge): CaptchaSolution {
  for (let number = 0; number <= task.maxNumber; number += 1) {
    if (createHash('sha256').update(task.salt + number).digest('hex') === task.challenge) {
      return { algorithm: task.algorithm, challenge: task.challenge, salt: task.salt, number, signature: task.signature }
    }
  }
  throw new Error('задача не решилась')
}

beforeEach(() => resetCaptcha())

describe('проверка «не робот»', () => {
  it('решённая задача принимается', () => {
    expect(verifySolution(solve(createChallenge(SECRET, NOW)), SECRET, NOW)).toBe(true)
  })

  it('одно решение действует один раз', () => {
    const solution = solve(createChallenge(SECRET, NOW))
    expect(verifySolution(solution, SECRET, NOW)).toBe(true)
    expect(verifySolution(solution, SECRET, NOW + 1)).toBe(false)
  })

  it('неверное число не принимается', () => {
    const solution = solve(createChallenge(SECRET, NOW))
    const wrong = { ...solution, number: (solution.number + 1) % (LOGIN_CAPTCHA.maxNumber + 1) }
    expect(verifySolution(wrong, SECRET, NOW)).toBe(false)
  })

  it('задачу, подписанную другим ключом, не принять', () => {
    const solution = solve(createChallenge('чужой-секрет', NOW))
    expect(verifySolution(solution, SECRET, NOW)).toBe(false)
  })

  it('задачу нельзя придумать самому: без подписи сервера не проходит', () => {
    const salt = `${'a'.repeat(24)}.${NOW + 60_000}.`
    const challenge = createHash('sha256').update(salt + 7).digest('hex')
    const forged: CaptchaSolution = { algorithm: 'SHA-256', challenge, salt, number: 7, signature: 'b'.repeat(64) }
    expect(verifySolution(forged, SECRET, NOW)).toBe(false)
  })

  it('истёкшая задача не принимается', () => {
    const solution = solve(createChallenge(SECRET, NOW))
    expect(verifySolution(solution, SECRET, NOW + LOGIN_CAPTCHA.ttlMs + 1)).toBe(false)
  })

  it('срок нельзя продлить, перенеся цифру из числа в соль', () => {
    // Хеш тот же, но срок «вырос» бы в десять раз, если бы длина срока не была
    // зафиксирована (SALT_PATTERN).
    const task = createChallenge(SECRET, NOW)
    const solution = solve(task)
    const digits = String(solution.number)
    if (digits.length < 2) return
    const shifted: CaptchaSolution = {
      ...solution,
      salt: solution.salt.slice(0, -1) + digits[0] + '.',
      number: Number(digits.slice(1)),
    }
    expect(verifySolution(shifted, SECRET, NOW)).toBe(false)
  })

  it('число вне границ и чужой алгоритм не принимаются', () => {
    const solution = solve(createChallenge(SECRET, NOW))
    expect(verifySolution({ ...solution, number: -1 }, SECRET, NOW)).toBe(false)
    expect(verifySolution({ ...solution, number: 1.5 }, SECRET, NOW)).toBe(false)
    expect(verifySolution({ ...solution, algorithm: 'SHA-1' }, SECRET, NOW)).toBe(false)
  })

  it('без решения — отказ', () => {
    expect(verifySolution(null, SECRET, NOW)).toBe(false)
  })
})

describe('решение из поля формы', () => {
  it('разбирает строку JSON', () => {
    const solution = solve(createChallenge(SECRET, NOW))
    expect(parseSolution(JSON.stringify(solution))).toEqual(solution)
  })

  it('мусор — null, а не исключение', () => {
    for (const raw of [undefined, null, '', 'не json', '[]', '{"number":"7"}', 42, 'x'.repeat(2_000)]) {
      expect(parseSolution(raw)).toBeNull()
    }
  })
})

describe('задача', () => {
  it('в пределах сложности и со сроком жизни', () => {
    const task = createChallenge(SECRET, NOW)
    expect(task.maxNumber).toBe(LOGIN_CAPTCHA.maxNumber)
    expect(task.salt).toMatch(/^[0-9a-f]{24}\.\d{13}\.$/)
    expect(Number(task.salt.split('.')[1])).toBe(NOW + LOGIN_CAPTCHA.ttlMs)
  })

  it('каждая задача своя', () => {
    expect(createChallenge(SECRET, NOW).salt).not.toBe(createChallenge(SECRET, NOW).salt)
  })
})
