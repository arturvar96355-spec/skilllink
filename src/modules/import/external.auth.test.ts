import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from '@/shared/http/errors'
import { assertIntegrationRequest } from './external.auth'

/**
 * Авторизация приёма данных извне (решение 145): без токена в окружении — 503
 * «интеграция не настроена», токен задан, но не совпал или не прислан — 401.
 */

const ORIGINAL = process.env.INTEGRATION_TOKEN

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.INTEGRATION_TOKEN
  else process.env.INTEGRATION_TOKEN = ORIGINAL
})

function request(authorization?: string): Request {
  return new Request('http://localhost/api/import/external', {
    method: 'POST',
    headers: authorization ? { authorization } : {},
  })
}

describe('assertIntegrationRequest', () => {
  it('INTEGRATION_TOKEN не задан — 503, а не 401 или 500', () => {
    delete process.env.INTEGRATION_TOKEN
    try {
      assertIntegrationRequest(request('Bearer whatever-token'))
      throw new Error('ожидалась ошибка')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('SERVICE_UNAVAILABLE')
    }
  })

  it('токен задан, заголовка нет — 401', () => {
    process.env.INTEGRATION_TOKEN = 'secret-1234567890'
    try {
      assertIntegrationRequest(request())
      throw new Error('ожидалась ошибка')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('UNAUTHORIZED')
    }
  })

  it('токен задан, прислан неверный — 401', () => {
    process.env.INTEGRATION_TOKEN = 'secret-1234567890'
    try {
      assertIntegrationRequest(request('Bearer wrong-token'))
      throw new Error('ожидалась ошибка')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('UNAUTHORIZED')
    }
  })

  it('токен задан, прислан без слова Bearer — 401', () => {
    process.env.INTEGRATION_TOKEN = 'secret-1234567890'
    try {
      assertIntegrationRequest(request('secret-1234567890'))
      throw new Error('ожидалась ошибка')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('UNAUTHORIZED')
    }
  })

  it('токен верный — не бросает', () => {
    process.env.INTEGRATION_TOKEN = 'secret-1234567890'
    expect(() => assertIntegrationRequest(request('Bearer secret-1234567890'))).not.toThrow()
  })

  it('токен верный, но разной длины с предъявленным — 401, без утечки длины по времени', () => {
    process.env.INTEGRATION_TOKEN = 'secret-1234567890'
    expect(() => assertIntegrationRequest(request('Bearer x'))).toThrowError(AppError)
  })
})
