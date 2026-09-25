import { expect } from 'vitest'
import { AppError, type ErrorCode } from '@/shared/http/errors'

/**
 * Хелперы тестов: «здесь обязана быть ошибка».
 *
 * `expect(fn).toThrow()` не проверяет код ошибки контракта, а ручной try/catch
 * без финального throw молча проходит, если ошибки не было вовсе. Поэтому
 * отсутствие ошибки — тоже падение теста.
 */

/** Вызов бросает AppError с кодом `code`. */
export function expectCode(fn: () => unknown, code: ErrorCode): void {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(code)
    return
  }
  throw new Error(`Ожидалась ошибка ${code}, но её не было`)
}

/** Промис отклоняется AppError с кодом `code`. */
export async function expectRejectCode(promise: Promise<unknown>, code: ErrorCode): Promise<void> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(code)
    return
  }
  throw new Error(`Ожидалась ошибка ${code}, но её не было`)
}

/** Брошенная вызовом ошибка — для проверок, которым нужен не только код. */
export function catchError(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  throw new Error('Ожидалась ошибка, но её не было')
}
