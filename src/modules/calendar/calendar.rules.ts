import { createHash, randomBytes } from 'node:crypto'
import { MEETING_FORMAT_LABELS, STAGE_STATUS_LABELS } from '@/shared/contracts/labels'
import type { MeetingFormat, StageStatus } from '@/shared/contracts/enums'
import { moscowIsoDate } from '@/shared/utils/date'
import { isOverdue, isPlanShifted } from '@/modules/workflow/workflow.rules'

/**
 * Лента календаря в формате iCalendar (RFC 5545) — своя, без библиотеки:
 * нужны десяток свойств, а правила формата короткие и покрыты тестами.
 *
 * Что важно по стандарту и проверено в calendar.test.ts:
 * - строки разделяются CRLF, в том числе после последней;
 * - строка длиннее 75 октетов сворачивается: перенос CRLF и пробел в начале
 *   продолжения; многобайтовый символ UTF-8 не разрывается;
 * - в текстовых значениях экранируются `\`, `;`, `,` и перевод строки;
 * - UID события стабилен: календарь по нему узнаёт, что событие то же самое,
 *   и обновляет его, а не заводит второе.
 */

// ── Токен ссылки ─────────────────────────────────────────────────────────────

/** 32 случайных байта: перебрать такой токен невозможно, ограничение попыток не нужно. */
const TOKEN_BYTES = 32
/** base64url от 32 байт без выравнивания — ровно 43 знака. */
const FEED_FILE_PATTERN = /^([A-Za-z0-9_-]{43})\.ics$/

export function generateFeedToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/**
 * В базе хранится только хеш токена. Соль и медленный хеш не нужны: токен —
 * 256 случайных бит, а не пароль, подбирать по хешу нечего.
 */
export function hashFeedToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Токен из последнего сегмента адреса `<токен>.ics`; всё прочее — null. */
export function tokenFromFileName(fileName: string): string | null {
  return FEED_FILE_PATTERN.exec(fileName)?.[1] ?? null
}

// ── Адреса ───────────────────────────────────────────────────────────────────

function originOf(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

/**
 * Публичный адрес сайта для ссылок в ленте и на саму ленту.
 *
 * Сначала `AUTH_URL` — адрес, по которому сайт открывают снаружи (за прокси
 * на стенде он задан обязательно), затем `APP_BASE_URL`, иначе локальный.
 * Из заголовков запроса адрес не берётся: `Host` задаёт тот, кто прислал запрос,
 * и подделанный заголовок увёл бы ссылку с токеном на чужой сайт.
 */
export function publicBaseUrl(env: Record<string, string | undefined>): string {
  return (
    originOf(env.AUTH_URL) ??
    originOf(env.APP_BASE_URL) ??
    `http://localhost:${env.PORT?.trim() || '3000'}`
  )
}

export function feedUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/api/calendar/${token}.ics`
}

/** webcal:// — тот же адрес; Apple Календарь и Outlook по нему сразу предлагают подписку. */
export function toWebcal(url: string): string {
  return url.replace(/^https?:/, 'webcal:')
}

// ── Формат iCalendar ─────────────────────────────────────────────────────────

const CRLF = '\r\n'
const MAX_LINE_OCTETS = 75

/**
 * Текстовое значение (TEXT, раздел 3.3.11 RFC 5545): `\` → `\\`, `;` → `\;`,
 * `,` → `\,`, перевод строки → `\n`. Управляющие символы, кроме табуляции,
 * в TEXT запрещены — они выбрасываются.
 */
export function escapeText(value: string): string {
  return value
    .replace(/\r\n|\r/g, '\n')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

function utf8Octets(codePoint: number): number {
  if (codePoint < 0x80) return 1
  if (codePoint < 0x800) return 2
  if (codePoint < 0x10000) return 3
  return 4
}

/** Символ целиком или экранированная пара `\,`, `\n` и т. п. */
const FOLD_UNIT = /\\[\s\S]|[\s\S]/gu

/**
 * Свёртка строки содержимого (раздел 3.1): не длиннее 75 октетов без CRLF,
 * продолжение начинается пробелом, и этот пробел входит в 75. Режется только
 * между символами: разорванная UTF-8-последовательность — битая кириллица.
 * Экранированная пара (`\,`, `\n`) тоже не разрывается: стандарт это разрешает,
 * но не все программы календаря склеивают такой перенос правильно.
 */
export function foldLine(line: string): string {
  const parts: string[] = []
  let current = ''
  let octets = 0
  for (const unit of line.match(FOLD_UNIT) ?? []) {
    let size = 0
    for (const char of unit) size += utf8Octets(char.codePointAt(0) ?? 0)
    if (octets + size > MAX_LINE_OCTETS) {
      parts.push(current)
      current = ' '
      octets = 1
    }
    current += unit
    octets += size
  }
  parts.push(current)
  return parts.join(CRLF)
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

/** Момент в UTC: `20260925T120000Z`. */
export function formatUtc(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  )
}

/** `2026-10-01` → `20261001`. */
function formatDate(isoDate: string): string {
  return isoDate.replace(/-/g, '')
}

/** `2026-10-01` → `01.10.2026` — как даты в интерфейсе. */
function humanDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-')
  return `${day}.${month}.${year}`
}

export type CalendarWhen =
  /** Событие на весь день: московская дата `ГГГГ-ММ-ДД`. */
  | { kind: 'day'; date: string }
  | { kind: 'time'; start: Date; durationMinutes: number }

export interface CalendarEvent {
  uid: string
  summary: string
  description: string
  url: string
  when: CalendarWhen
  /** Момент, по которому событие ближе или дальше от сегодняшнего дня. */
  at: Date
}

function eventLines(event: CalendarEvent, stamp: string): string[] {
  const lines = ['BEGIN:VEVENT', `UID:${event.uid}`, `DTSTAMP:${stamp}`]
  if (event.when.kind === 'day') {
    // DTEND для события на весь день — следующий день, не включительно (раздел 3.6.1).
    const start = new Date(`${event.when.date}T00:00:00Z`)
    const next = new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    lines.push(
      `DTSTART;VALUE=DATE:${formatDate(event.when.date)}`,
      `DTEND;VALUE=DATE:${formatDate(next)}`,
      // Срок не занимает время в расписании: встречу на этот день ставить можно.
      'TRANSP:TRANSPARENT',
    )
  } else {
    lines.push(
      `DTSTART:${formatUtc(event.when.start)}`,
      `DURATION:PT${Math.max(1, Math.round(event.when.durationMinutes))}M`,
    )
  }
  lines.push(
    `SUMMARY:${escapeText(event.summary)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    // URL — значение типа URI, не TEXT: запятые и точки с запятой в нём не экранируются.
    `URL:${event.url}`,
    'END:VEVENT',
  )
  return lines
}

export interface CalendarOptions {
  name: string
  now: Date
  refreshIntervalHours: number
}

/** Документ iCalendar целиком. Пустая лента — корректный календарь без событий. */
export function renderCalendar(events: readonly CalendarEvent[], options: CalendarOptions): string {
  const stamp = formatUtc(options.now)
  const refresh = `PT${options.refreshIntervalHours}H`
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SkillLink//Calendar feed//RU',
    'CALSCALE:GREGORIAN',
    // Опубликованная лента, а не приглашение: DTSTAMP — время сборки ленты.
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(options.name)}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${refresh}`,
    `X-PUBLISHED-TTL:${refresh}`,
    ...events.flatMap((event) => eventLines(event, stamp)),
    'END:VCALENDAR',
  ]
  return lines.map(foldLine).join(CRLF) + CRLF
}

// ── События ленты ────────────────────────────────────────────────────────────

/** Незакрытый этап со сроком в связке пользователя. Без ФИО и контактов. */
export interface StageDeadlineItem {
  stageId: string
  stageNumber: number
  stageTitle: string
  status: StageStatus
  deadline: Date
  cooperationId: string
  /** Краткое имя вуза, если есть, иначе полное. */
  universityName: string
  programName: string
}

/** Встреча, где пользователь ответственный или участник. Участников в ленте нет. */
export interface MeetingItem {
  meetingId: string
  date: Date
  topic: string
  format: MeetingFormat
  cooperationId: string | null
  universityId: string | null
  programId: string | null
  universityName: string | null
  programName: string | null
}

export const OVERDUE_MARK = '[Просрочен]'
export const PLAN_SHIFTED_MARK = '[План сдвинут]'

export function stageEvent(item: StageDeadlineItem, baseUrl: string, now: Date): CalendarEvent {
  const url = `${baseUrl}/cooperations/${item.cooperationId}?stage=${item.stageId}`
  const date = moscowIsoDate(item.deadline)
  // Пометки — по тем же правилам, что у карточки связки: просрочен этап в работе
  // или заблокированный; не начатый с прошедшим сроком — «план сдвинут», не просрочка.
  const overdue = isOverdue(item.deadline, item.status, now)
  const shifted = !overdue && isPlanShifted(item.deadline, item.status, now)
  const mark = overdue ? `${OVERDUE_MARK} ` : shifted ? `${PLAN_SHIFTED_MARK} ` : ''

  const description = [
    `Статус этапа: ${STAGE_STATUS_LABELS[item.status]}`,
    `Срок: ${humanDate(date)}`,
    ...(overdue ? ['Срок прошёл, этап не закрыт.'] : []),
    ...(shifted ? ['Срок прошёл, этап ещё не начат.'] : []),
    `Карточка связки: ${url}`,
  ].join('\n')

  return {
    uid: `stage-${item.stageId}@skilllink`,
    summary:
      `${mark}Срок: этап ${item.stageNumber} «${item.stageTitle}» — ` +
      `${item.universityName}, ${item.programName}`,
    description,
    url,
    when: { kind: 'day', date },
    at: item.deadline,
  }
}

function meetingLink(item: MeetingItem, baseUrl: string): { url: string; label: string } {
  if (item.cooperationId) return { url: `${baseUrl}/cooperations/${item.cooperationId}`, label: 'Карточка связки' }
  if (item.universityId) return { url: `${baseUrl}/universities/${item.universityId}`, label: 'Карточка вуза' }
  if (item.programId) return { url: `${baseUrl}/programs/${item.programId}`, label: 'Карточка программы' }
  return { url: baseUrl, label: 'SkillLink' }
}

export function meetingEvent(
  item: MeetingItem,
  baseUrl: string,
  durationMinutes: number,
): CalendarEvent {
  const format = MEETING_FORMAT_LABELS[item.format]
  const link = meetingLink(item, baseUrl)
  const description = [
    `Формат: ${format}`,
    ...(item.universityName ? [`Вуз: ${item.universityName}`] : []),
    ...(item.programName ? [`Программа: ${item.programName}`] : []),
    `${link.label}: ${link.url}`,
  ].join('\n')

  return {
    uid: `meeting-${item.meetingId}@skilllink`,
    summary: `Встреча (${format.toLowerCase()}): ${item.topic}`,
    description,
    url: link.url,
    when: { kind: 'time', start: item.date, durationMinutes },
    at: item.date,
  }
}

/**
 * Не больше `max` событий. Лишними считаются самые далёкие от сегодняшнего дня —
 * и в прошлое, и в будущее: ближайшие сроки и просрочки важнее прошлогодних.
 * Итог — по времени, при равенстве — по UID, чтобы лента не менялась от запроса к запросу.
 */
export function limitEvents(
  events: readonly CalendarEvent[],
  max: number,
  now: Date,
): CalendarEvent[] {
  const byTime = (a: CalendarEvent, b: CalendarEvent) =>
    a.at.getTime() - b.at.getTime() || a.uid.localeCompare(b.uid)
  const distance = (event: CalendarEvent) => Math.abs(event.at.getTime() - now.getTime())

  const kept =
    events.length <= max
      ? [...events]
      : [...events].sort((a, b) => distance(a) - distance(b) || byTime(a, b)).slice(0, max)
  return kept.sort(byTime)
}
