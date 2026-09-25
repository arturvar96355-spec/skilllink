import { findNumber } from './captcha-search'

/**
 * Фоновый поток проверки «не робот» (решение 100): перебор идёт здесь, чтобы
 * страница входа и созвездие за ней не подтормаживали.
 */

export interface CaptchaTask {
  salt: string
  challenge: string
  maxNumber: number
}

export interface CaptchaReply {
  number: number | null
}

/** Нужная часть глобального объекта фонового потока (библиотеки типов webworker в проекте нет). */
interface WorkerScope {
  postMessage(message: CaptchaReply): void
  onmessage: ((event: MessageEvent<CaptchaTask>) => void) | null
}

const worker = self as unknown as WorkerScope

worker.onmessage = (event: MessageEvent<CaptchaTask>) => {
  const { salt, challenge, maxNumber } = event.data
  void findNumber(salt, challenge, maxNumber).then((number) => worker.postMessage({ number }))
}
