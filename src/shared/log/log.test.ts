import { afterEach, describe, expect, it } from 'vitest'
import { captureLog, formatLogLine, log, type LogLevel } from './logger'
import { REDACTED, TOKEN_REDACTED, isSensitiveKey, maskEmail, redact, redactString } from './redact'
import { currentRequestId, runWithRequestId } from './request-context'

/** Токен того же вида, что выдаёт BotFather; не настоящий. */
const BOT_TOKEN = '123456789:AAHfakeTokenForTests_abcdefghijklmnopq'
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl'

describe('redactString: секреты по виду значения', () => {
  it('токен бота — в тексте, в адресе /bot<токен>/, в тексте ошибки', () => {
    expect(redactString(`токен ${BOT_TOKEN} утёк`)).toBe(`токен ${TOKEN_REDACTED} утёк`)
    expect(redactString(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`)).toBe(
      `https://api.telegram.org/bot${TOKEN_REDACTED}/sendMessage`,
    )
  })

  it('JWT, Bearer и секреты в параметрах адреса', () => {
    expect(redactString(`cookie=${JWT}`)).not.toContain('eyJ')
    expect(redactString('Authorization: Bearer abc.def-123')).toBe(`Authorization: Bearer ${REDACTED}`)
    expect(redactString('https://x.test/cb?code=1&access_token=zzz&page=2')).toBe(
      `https://x.test/cb?code=1&access_token=${REDACTED}&page=2`,
    )
    expect(redactString('/feed?api_key=secret123')).toBe(`/feed?api_key=${REDACTED}`)
  })

  it('почта → первая буква и домен', () => {
    expect(maskEmail('ivanov.petr@univ.example.ru')).toBe('i***@univ.example.ru')
    expect(redactString('письмо ушло на a.b@x.ru и c@y.org')).toBe('письмо ушло на a***@x.ru и c***@y.org')
  })

  it('телефон → последние четыре цифры, в любом написании', () => {
    for (const phone of ['+7 (912) 345-67-89', '8 912 345 67 89', '+79123456789', '8-912-345-67-89']) {
      expect(redactString(`тел. ${phone}.`)).toBe('тел. ***6789.')
    }
    expect(redactString('+44 20 7946 0958')).toBe('***0958')
  })

  it('даты, время, идентификаторы и числа не портятся', () => {
    const text = '2026-09-25 10:00:00 связка cmabc123def456 update_id 123456 HTTP 502 попытка 2/2'
    expect(redactString(text)).toBe(text)
    expect(redactString('2026-09-25T10:00:00.000Z')).toBe('2026-09-25T10:00:00.000Z')
  })

  it('длинная строка обрезается', () => {
    expect(redactString('x'.repeat(10_000)).length).toBeLessThan(4100)
  })
})

describe('redact: секреты по имени поля на любой глубине', () => {
  it('имена полей в любом написании', () => {
    for (const key of ['password', 'newPassword', 'api_key', 'apiKey', 'X-Api-Key', 'authorization', 'Cookie', 'set-cookie', 'botToken', 'webhookSecret', 'AUTH_SECRET']) {
      expect(isSensitiveKey(key), key).toBe(true)
    }
    for (const key of ['requestId', 'userId', 'status', 'message', 'fields']) {
      expect(isSensitiveKey(key), key).toBe(false)
    }
  })

  it('вложенные объекты и массивы', () => {
    const value = redact({
      user: { id: 'u1', password: 'p@ss', profile: { email: 'ivan@univ.ru', tokens: ['a'] } },
      headers: { Authorization: 'Bearer xyz', cookie: 'authjs.session-token=abc' },
      list: [{ apiKey: 'k' }, { phone: '+7 912 345 67 89' }],
    })
    expect(value).toEqual({
      user: { id: 'u1', password: REDACTED, profile: { email: 'i***@univ.ru', tokens: REDACTED } },
      headers: { Authorization: REDACTED, cookie: REDACTED },
      list: [{ apiKey: REDACTED }, { phone: '***6789' }],
    })
  })

  it('ошибка: сообщение, стек и цепочка cause — без токена, почты и данных запроса', () => {
    const root = new Error(`connect failed https://api.telegram.org/bot${BOT_TOKEN}/getMe`)
    const error = new Error(`отправка для ivan@univ.ru не удалась`, { cause: root })
    error.stack = `Error: отправка для ivan@univ.ru не удалась\n    at send (/app/bot${BOT_TOKEN}.js:1:1)`
    const json = JSON.stringify(redact({ err: error }))
    expect(json).not.toContain(BOT_TOKEN)
    expect(json).not.toContain('ivan@univ.ru')
    expect(json).toContain('i***@univ.ru')
    expect(json).toContain('"cause"')
    expect(json).toContain('at send')
  })

  it('ошибка Prisma: от сообщения — только последняя строка (в начале — вызов с данными)', () => {
    const error = new Error('\nInvalid `prisma.contact.create()` invocation:\n{ data: { fullName: "Иванов Иван" } }\n\nUnique constraint failed')
    error.name = 'PrismaClientKnownRequestError'
    Object.assign(error, { code: 'P2002' })
    const value = redact(error) as { message: string; code: string }
    expect(value.message).toBe('Unique constraint failed')
    expect(value.code).toBe('P2002')
    expect(JSON.stringify(value)).not.toContain('Иванов')
  })

  it('циклы, BigInt, даты и глубина не ломают журнал', () => {
    const cyclic: Record<string, unknown> = { id: 1n, at: new Date('2026-09-25T00:00:00Z') }
    cyclic.self = cyclic
    const value = redact(cyclic) as Record<string, unknown>
    expect(value.id).toBe('1')
    expect(value.at).toBe('2026-09-25T00:00:00.000Z')
    expect(value.self).toBe('[циклическая ссылка]')
    let deep: Record<string, unknown> = { leaf: true }
    for (let i = 0; i < 20; i += 1) deep = { deep }
    expect(() => JSON.stringify(redact(deep))).not.toThrow()
  })
})

describe('журнал: строка JSON с номером запроса', () => {
  let restore: (() => void) | null = null
  afterEach(() => restore?.())

  it('ts, level, msg, requestId и поля — без секретов', () => {
    const lines: Array<{ level: LogLevel; line: string }> = []
    restore = captureLog((level, line) => lines.push({ level, line }))

    runWithRequestId('req-123', () => {
      log.error('сбой отправки', { token: BOT_TOKEN, url: `https://api.telegram.org/bot${BOT_TOKEN}/x`, count: 2 })
    })
    log.info('вне запроса')

    expect(lines).toHaveLength(2)
    const first = JSON.parse(lines[0]!.line) as Record<string, unknown>
    expect(lines[0]!.level).toBe('error')
    expect(first).toMatchObject({ level: 'error', msg: 'сбой отправки', requestId: 'req-123', token: REDACTED, count: 2 })
    expect(typeof first.ts).toBe('string')
    expect(lines[0]!.line).not.toContain(BOT_TOKEN)
    expect(JSON.parse(lines[1]!.line).requestId).toBeUndefined()
  })

  it('служебные ключи не перетираются полями', () => {
    const line = JSON.parse(formatLogLine('warn', 'm', { level: 'info', msg: 'x', ts: 'y' }))
    expect(line.level).toBe('warn')
    expect(line.msg).toBe('m')
    expect(line.ts).not.toBe('y')
  })

  it('номер запроса виден на всю глубину асинхронного вызова', async () => {
    const seen = await runWithRequestId('abc', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      return currentRequestId()
    })
    expect(seen).toBe('abc')
    expect(currentRequestId()).toBeNull()
  })
})
