import { describe, expect, it } from 'vitest'
import {
  OVERDUE_MARK,
  PLAN_SHIFTED_MARK,
  escapeText,
  feedUrl,
  foldLine,
  generateFeedToken,
  hashFeedToken,
  limitEvents,
  meetingEvent,
  publicBaseUrl,
  renderCalendar,
  stageEvent,
  toWebcal,
  tokenFromFileName,
  type CalendarEvent,
  type MeetingItem,
  type StageDeadlineItem,
} from './calendar.rules'

/** Генератор iCalendar и правила ленты (решение 105). База здесь не нужна. */

const NOW = new Date('2026-09-25T09:00:00Z')
const BASE = 'https://skilllink.example'
const OPTIONS = { name: 'SkillLink — сроки и встречи', now: NOW, refreshIntervalHours: 1 }

const octets = (line: string) => Buffer.byteLength(line, 'utf8')

/** Развёртка по RFC 5545: CRLF и один пробел или табуляция в начале — склейка. */
const unfold = (text: string) => text.replace(/\r\n[ \t]/g, '')

function stage(overrides: Partial<StageDeadlineItem> = {}): StageDeadlineItem {
  return {
    stageId: 'stage-1',
    stageNumber: 6,
    stageTitle: 'Подписание документов',
    status: 'IN_PROGRESS',
    deadline: new Date('2026-10-01T09:00:00Z'),
    cooperationId: 'coop-1',
    universityName: 'СПбГУТ',
    programName: 'Программная инженерия',
    ...overrides,
  }
}

function meeting(overrides: Partial<MeetingItem> = {}): MeetingItem {
  return {
    meetingId: 'meeting-1',
    date: new Date('2026-09-28T11:30:00Z'),
    topic: 'Согласование программы курса',
    format: 'ONLINE',
    cooperationId: 'coop-1',
    universityId: null,
    programId: null,
    universityName: 'СПбГУТ',
    programName: 'Программная инженерия',
    ...overrides,
  }
}

describe('экранирование текстовых значений', () => {
  it('обратная косая, точка с запятой, запятая и перевод строки', () => {
    expect(escapeText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne')
  })

  it('CRLF и одиночный CR — один перевод строки', () => {
    expect(escapeText('раз\r\nдва\rтри')).toBe('раз\\nдва\\nтри')
  })

  it('управляющие символы выбрасываются, табуляция остаётся', () => {
    expect(escapeText('a\u0000b\u0007c\td\u007f')).toBe('abc\td')
  })

  it('обратная косая экранируется раньше остального — «\\;» не превращается в «\\\\;» наполовину', () => {
    expect(escapeText('\\;')).toBe('\\\\\\;')
  })
})

describe('свёртка строк', () => {
  it('короткая строка не меняется', () => {
    expect(foldLine('SUMMARY:коротко')).toBe('SUMMARY:коротко')
  })

  it('каждая физическая строка — не длиннее 75 октетов, продолжение с пробела', () => {
    const line = `SUMMARY:${'Срок этапа «Подписание документов» — '.repeat(6)}`
    const folded = foldLine(line)
    const physical = folded.split('\r\n')
    expect(physical.length).toBeGreaterThan(1)
    for (const [index, part] of physical.entries()) {
      expect(octets(part)).toBeLessThanOrEqual(75)
      if (index > 0) expect(part.startsWith(' ')).toBe(true)
    }
    expect(unfold(folded)).toBe(line)
  })

  it('многобайтовые символы не разрываются', () => {
    const line = `X:${'ж'.repeat(200)}${'😀'.repeat(40)}`
    const physical = foldLine(line).split('\r\n')
    for (const part of physical) {
      // Разрыв посередине UTF-8 дал бы символ замены при обратном декодировании.
      expect(Buffer.from(part, 'utf8').toString('utf8')).toBe(part)
      expect(part).not.toContain('�')
      expect(octets(part)).toBeLessThanOrEqual(75)
    }
    expect(unfold(physical.join('\r\n'))).toBe(line)
  })

  it('экранированная пара не разрывается переносом', () => {
    for (let prefix = 60; prefix < 80; prefix += 1) {
      const line = `DESCRIPTION:${'x'.repeat(prefix)}${escapeText('a,b;c\\d\ne,'.repeat(4))}`
      const physical = foldLine(line).split('\r\n')
      for (const part of physical) {
        // Нечётное число обратных косых в конце строки — перенос внутри пары.
        expect((/\\+$/.exec(part)?.[0].length ?? 0) % 2).toBe(0)
        expect(octets(part)).toBeLessThanOrEqual(75)
      }
      expect(unfold(physical.join('\r\n'))).toBe(line)
    }
  })

  it('ровно 75 октетов — без переноса, 76 — с переносом', () => {
    expect(foldLine('A'.repeat(75))).toBe('A'.repeat(75))
    expect(foldLine('A'.repeat(76))).toBe(`${'A'.repeat(75)}\r\n A`)
  })
})

describe('документ iCalendar', () => {
  it('пустая лента — корректный календарь без событий', () => {
    const text = renderCalendar([], OPTIONS)
    expect(text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true)
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(text).toContain('PRODID:')
    expect(text).not.toContain('BEGIN:VEVENT')
  })

  it('все переводы строк — CRLF, одиночных LF нет', () => {
    const text = renderCalendar([stageEvent(stage(), BASE, NOW), meetingEvent(meeting(), BASE, 60)], OPTIONS)
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    for (const line of text.split('\r\n')) expect(octets(line)).toBeLessThanOrEqual(75)
  })

  it('срок этапа — событие на весь день в московскую дату срока', () => {
    // 30.09, 22:00 UTC — это уже 1 октября по Москве.
    const text = unfold(
      renderCalendar([stageEvent(stage({ deadline: new Date('2026-09-30T22:00:00Z') }), BASE, NOW)], OPTIONS),
    )
    expect(text).toContain('DTSTART;VALUE=DATE:20261001\r\n')
    expect(text).toContain('DTEND;VALUE=DATE:20261002\r\n')
    expect(text).toContain('TRANSP:TRANSPARENT')
  })

  it('встреча — время в UTC и длительность', () => {
    const text = unfold(renderCalendar([meetingEvent(meeting(), BASE, 60)], OPTIONS))
    expect(text).toContain('DTSTART:20260928T113000Z\r\n')
    expect(text).toContain('DURATION:PT60M\r\n')
    expect(text).toContain('DTSTAMP:20260925T090000Z\r\n')
  })

  it('UID стабилен: та же запись в другой момент — тот же UID', () => {
    const first = stageEvent(stage(), BASE, NOW)
    const later = stageEvent(stage({ status: 'BLOCKED' }), BASE, new Date('2026-12-01T00:00:00Z'))
    expect(first.uid).toBe('stage-stage-1@skilllink')
    expect(later.uid).toBe(first.uid)
    expect(meetingEvent(meeting(), BASE, 60).uid).toBe(meetingEvent(meeting(), BASE, 30).uid)
    expect(meetingEvent(meeting(), BASE, 60).uid).not.toBe(first.uid)
  })

  it('запятые и точки с запятой в заголовке экранируются, в URL — нет', () => {
    const text = unfold(
      renderCalendar([meetingEvent(meeting({ topic: 'План; бюджет, сроки' }), BASE, 60)], OPTIONS),
    )
    expect(text).toContain('SUMMARY:Встреча (онлайн): План\\; бюджет\\, сроки\r\n')
    expect(text).toContain(`URL:${BASE}/cooperations/coop-1\r\n`)
  })
})

describe('заголовки и ссылки событий', () => {
  it('срок: «Срок: этап N «название» — вуз, программа» и ссылка на этап в карточке связки', () => {
    const event = stageEvent(stage(), BASE, NOW)
    expect(event.summary).toBe('Срок: этап 6 «Подписание документов» — СПбГУТ, Программная инженерия')
    expect(event.url).toBe(`${BASE}/cooperations/coop-1?stage=stage-1`)
    expect(event.description).toContain(event.url)
    expect(event.description).toContain('Срок: 01.10.2026')
  })

  it('просроченный этап помечен в заголовке, не начатый с прошедшим сроком — «план сдвинут»', () => {
    const past = new Date('2026-09-20T09:00:00Z')
    expect(stageEvent(stage({ deadline: past }), BASE, NOW).summary.startsWith(`${OVERDUE_MARK} Срок:`)).toBe(true)
    expect(stageEvent(stage({ deadline: past, status: 'BLOCKED' }), BASE, NOW).summary).toContain(OVERDUE_MARK)
    const notStarted = stageEvent(stage({ deadline: past, status: 'NOT_STARTED' }), BASE, NOW)
    expect(notStarted.summary.startsWith(`${PLAN_SHIFTED_MARK} Срок:`)).toBe(true)
    expect(notStarted.summary).not.toContain(OVERDUE_MARK)
    expect(stageEvent(stage(), BASE, NOW).summary).not.toContain('[')
  })

  it('встреча без связки ведёт в карточку вуза, без вуза — программы', () => {
    expect(meetingEvent(meeting({ cooperationId: null, universityId: 'u-1' }), BASE, 60).url).toBe(
      `${BASE}/universities/u-1`,
    )
    expect(meetingEvent(meeting({ cooperationId: null, programId: 'p-1' }), BASE, 60).url).toBe(
      `${BASE}/programs/p-1`,
    )
  })

  it('в событии встречи — тема, формат и вуз, и никаких участников', () => {
    const event = meetingEvent(meeting({ format: 'OFFLINE' }), BASE, 60)
    expect(event.summary).toBe('Встреча (очно): Согласование программы курса')
    expect(event.description).toContain('Формат: Очно')
    expect(event.description).toContain('Вуз: СПбГУТ')
    expect(event.description).not.toMatch(/участ/i)
  })
})

describe('предел числа событий', () => {
  const at = (iso: string, uid: string): CalendarEvent => ({
    uid,
    summary: uid,
    description: '',
    url: BASE,
    when: { kind: 'day', date: iso.slice(0, 10) },
    at: new Date(iso),
  })

  it('при переполнении уходят самые далёкие от сегодняшнего дня, итог — по времени', () => {
    const events = [
      at('2020-01-01T00:00:00Z', 'old'),
      at('2026-09-26T00:00:00Z', 'tomorrow'),
      at('2026-09-20T00:00:00Z', 'last-week'),
      at('2030-01-01T00:00:00Z', 'far'),
    ]
    expect(limitEvents(events, 2, NOW).map((event) => event.uid)).toEqual(['last-week', 'tomorrow'])
  })

  it('без переполнения ничего не теряется', () => {
    const events = [at('2030-01-01T00:00:00Z', 'b'), at('2020-01-01T00:00:00Z', 'a')]
    expect(limitEvents(events, 500, NOW).map((event) => event.uid)).toEqual(['a', 'b'])
  })
})

describe('токен ссылки', () => {
  it('32 случайных байта в base64url — 43 знака, каждый раз новый', () => {
    const first = generateFeedToken()
    const second = generateFeedToken()
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(first, 'base64url')).toHaveLength(32)
    expect(second).not.toBe(first)
  })

  it('в базу идёт SHA-256 от токена — 64 шестнадцатеричных знака, не сам токен', () => {
    const token = generateFeedToken()
    const hash = hashFeedToken(token)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain(token)
    expect(hashFeedToken(token)).toBe(hash)
    expect(hashFeedToken(generateFeedToken())).not.toBe(hash)
  })

  it('из адреса принимается только «<43 знака>.ics»', () => {
    const token = generateFeedToken()
    expect(tokenFromFileName(`${token}.ics`)).toBe(token)
    for (const bad of [token, `${token}.ICS`, `${token}x.ics`, `${token.slice(1)}.ics`, '.ics', `../${token}.ics`, `${token}.ics.ics`]) {
      expect(tokenFromFileName(bad)).toBeNull()
    }
  })

  it('адрес ленты — от AUTH_URL, затем APP_BASE_URL; заголовки запроса не участвуют', () => {
    expect(publicBaseUrl({ AUTH_URL: 'https://site.example/', APP_BASE_URL: 'http://localhost:3000' })).toBe(
      'https://site.example',
    )
    expect(publicBaseUrl({ APP_BASE_URL: 'http://localhost:3133' })).toBe('http://localhost:3133')
    expect(publicBaseUrl({ AUTH_URL: 'не адрес', PORT: '3200' })).toBe('http://localhost:3200')
    const url = feedUrl('https://site.example', 'abc')
    expect(url).toBe('https://site.example/api/calendar/abc.ics')
    expect(toWebcal(url)).toBe('webcal://site.example/api/calendar/abc.ics')
  })
})
