import { describe, expect, it } from 'vitest'
import { parseEml } from './inbound-letters.eml'

const CRLF = '\r\n'

function eml(headers: string, body: string): Uint8Array {
  return new TextEncoder().encode(`${headers}${CRLF}${CRLF}${body}`)
}

describe('parseEml: простой .eml без вложений', () => {
  it('текст в UTF-8 без кодирования', () => {
    const parsed = parseEml(
      eml(
        [
          'From: "Иванова Мария" <maria@university.example.invalid>',
          'Subject: Вопрос по программе',
          'Date: Fri, 26 Sep 2026 10:00:00 +0300',
          'Message-ID: <abc123@university.example.invalid>',
          'Content-Type: text/plain; charset=utf-8',
        ].join(CRLF),
        'Добрый день!\r\nУточните, пожалуйста, сроки начала занятий.',
      ),
    )
    expect(parsed.from).toEqual({ name: 'Иванова Мария', email: 'maria@university.example.invalid' })
    expect(parsed.subject).toBe('Вопрос по программе')
    expect(parsed.messageId).toBe('abc123@university.example.invalid')
    expect(parsed.date?.getUTCFullYear()).toBe(2026)
    expect(parsed.bodyText).toContain('Уточните, пожалуйста, сроки начала занятий.')
  })

  it('адрес без имени', () => {
    const parsed = parseEml(
      eml(['From: rector@university.example.invalid', 'Subject: Тема', 'Content-Type: text/plain; charset=utf-8'].join(CRLF), 'Текст'),
    )
    expect(parsed.from).toEqual({ name: null, email: 'rector@university.example.invalid' })
  })

  it('тема в кодированных словах (RFC 2047, UTF-8 base64)', () => {
    // "Договор" в UTF-8 base64.
    const encoded = Buffer.from('Договор', 'utf-8').toString('base64')
    const parsed = parseEml(
      eml(
        ['From: a@b.invalid', `Subject: =?UTF-8?B?${encoded}?=`, 'Content-Type: text/plain; charset=utf-8'].join(CRLF),
        'Текст',
      ),
    )
    expect(parsed.subject).toBe('Договор')
  })

  it('quoted-printable в UTF-8', () => {
    const parsed = parseEml(
      eml(
        ['From: a@b.invalid', 'Subject: Тема', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable'].join(
          CRLF,
        ),
        Buffer.from('Прошу перенести встречу на среду.', 'utf-8')
          .toString('latin1')
          .split('')
          .map((c) => (c.charCodeAt(0) > 126 || c.charCodeAt(0) < 32 ? `=${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}` : c))
          .join(''),
      ),
    )
    expect(parsed.bodyText).toContain('Прошу перенести встречу на среду.')
  })

  it('base64 в UTF-8', () => {
    const text = 'Приостанавливаем сотрудничество на этот учебный год.'
    const parsed = parseEml(
      eml(
        ['From: a@b.invalid', 'Subject: Тема', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64'].join(CRLF),
        Buffer.from(text, 'utf-8').toString('base64'),
      ),
    )
    expect(parsed.bodyText).toBe(text)
  })

  it('свёрнутый заголовок (продолжение со следующей строки с отступом) не ломает разбор', () => {
    const parsed = parseEml(
      eml(
        ['From: a@b.invalid', 'Subject: Очень длинная тема,\r\n продолженная на следующей строке', 'Content-Type: text/plain; charset=utf-8'].join(
          CRLF,
        ),
        'Текст',
      ),
    )
    expect(parsed.subject).toBe('Очень длинная тема, продолженная на следующей строке')
  })
})

describe('parseEml: multipart', () => {
  it('multipart/alternative — берёт text/plain, а не text/html', () => {
    const boundary = 'BOUND1'
    const body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Простой текст письма.',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>HTML версия</p>',
      `--${boundary}--`,
      '',
    ].join(CRLF)
    const parsed = parseEml(
      eml(['From: a@b.invalid', 'Subject: Тема', `Content-Type: multipart/alternative; boundary="${boundary}"`].join(CRLF), body),
    )
    expect(parsed.bodyText).toBe('Простой текст письма.')
  })

  it('только text/html — тегами разметка вырезается', () => {
    const boundary = 'BOUND2'
    const body = [
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Добрый день!</p><p>Просим выслать <b>документы</b>.</p>',
      `--${boundary}--`,
      '',
    ].join(CRLF)
    const parsed = parseEml(
      eml(['From: a@b.invalid', 'Subject: Тема', `Content-Type: multipart/mixed; boundary="${boundary}"`].join(CRLF), body),
    )
    expect(parsed.bodyText).toContain('Добрый день!')
    expect(parsed.bodyText).toContain('Просим выслать документы.')
    expect(parsed.bodyText).not.toContain('<p>')
  })

  it('вложенный multipart/alternative внутри multipart/mixed', () => {
    const inner = 'INNER1'
    const outer = 'OUTER1'
    const innerPart = [
      `--${inner}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Текст из вложенной части.',
      `--${inner}--`,
      '',
    ].join(CRLF)
    const body = [
      `--${outer}`,
      `Content-Type: multipart/alternative; boundary="${inner}"`,
      '',
      innerPart,
      `--${outer}--`,
      '',
    ].join(CRLF)
    const parsed = parseEml(
      eml(['From: a@b.invalid', 'Subject: Тема', `Content-Type: multipart/mixed; boundary="${outer}"`].join(CRLF), body),
    )
    expect(parsed.bodyText).toBe('Текст из вложенной части.')
  })
})
