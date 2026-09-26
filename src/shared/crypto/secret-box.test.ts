import { describe, expect, it } from 'vitest'
import { decryptSecretValue, encryptSecretValue } from './secret-box'

/**
 * Шифрование значений в system_secrets (решение 142): токен бота Telegram
 * читается обратно, а не только сравнивается, как секрет вебхука (webhookSecretHash).
 */

describe('encryptSecretValue / decryptSecretValue', () => {
  it('шифрует и расшифровывает тем же секретом', () => {
    const packed = encryptSecretValue('auth-secret', '123456:AAHfakeTokenForTests')
    expect(packed).not.toContain('123456')
    expect(decryptSecretValue('auth-secret', packed)).toBe('123456:AAHfakeTokenForTests')
  })

  it('формат — три части base64 через |', () => {
    const packed = encryptSecretValue('auth-secret', 'значение')
    const parts = packed.split('|')
    expect(parts).toHaveLength(3)
    for (const part of parts) expect(() => Buffer.from(part, 'base64')).not.toThrow()
  })

  it('другой секрет (например, сменили AUTH_SECRET) — null, а не мусор', () => {
    const packed = encryptSecretValue('auth-secret', 'токен')
    expect(decryptSecretValue('другой-секрет', packed)).toBeNull()
  })

  it('испорченная запись — null, а не исключение', () => {
    expect(decryptSecretValue('auth-secret', 'не|формат')).toBeNull()
    expect(decryptSecretValue('auth-secret', 'aa|bb|cc')).toBeNull()
    expect(decryptSecretValue('auth-secret', 'совсем не то')).toBeNull()
  })

  it('два шифрования одного значения дают разные записи (случайный nonce)', () => {
    const first = encryptSecretValue('auth-secret', 'токен')
    const second = encryptSecretValue('auth-secret', 'токен')
    expect(first).not.toBe(second)
    expect(decryptSecretValue('auth-secret', first)).toBe('токен')
    expect(decryptSecretValue('auth-secret', second)).toBe('токен')
  })
})
