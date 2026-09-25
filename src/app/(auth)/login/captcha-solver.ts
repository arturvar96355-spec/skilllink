import type { CaptchaChallenge } from '@/shared/auth/captcha'
import { findNumber } from './captcha-search'
import type { CaptchaReply, CaptchaTask } from './captcha.worker'

/**
 * Проверка «не робот» на стороне браузера (решение 100): получить задачу,
 * решить её и вернуть решение строкой — она уходит на вход полем `captcha`.
 *
 * Бросает ошибку, если сервер не ответил: экран входа скажет «сервер не ответил».
 */
export async function passCaptcha(): Promise<string> {
  const response = await fetch('/api/login-challenge', { cache: 'no-store' })
  if (!response.ok) throw new Error(`Задача не получена: ${response.status}`)
  const { data } = (await response.json()) as { data: CaptchaChallenge }

  const number = await solve({ salt: data.salt, challenge: data.challenge, maxNumber: data.maxNumber })
  if (number === null) throw new Error('Задача не решилась')

  return JSON.stringify({
    algorithm: data.algorithm,
    challenge: data.challenge,
    salt: data.salt,
    number,
    signature: data.signature,
  })
}

/** В фоновом потоке, а если он не завёлся — прямо на странице: медленнее, но вход не встанет. */
function solve(task: CaptchaTask): Promise<number | null> {
  const onPage = () => findNumber(task.salt, task.challenge, task.maxNumber)
  if (typeof Worker === 'undefined') return onPage()

  let worker: Worker
  try {
    worker = new Worker(new URL('./captcha.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return onPage()
  }
  return new Promise((resolve) => {
    worker.onmessage = (event: MessageEvent<CaptchaReply>) => {
      worker.terminate()
      resolve(event.data.number)
    }
    worker.onerror = () => {
      worker.terminate()
      resolve(onPage())
    }
    worker.postMessage(task)
  })
}
