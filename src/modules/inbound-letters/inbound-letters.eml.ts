import { normalizeEmail } from '@/shared/utils/contacts'

/**
 * Простой разбор `.eml` (RFC 5322 + минимум MIME) — без новых зависимостей.
 *
 * Не полный парсер почты: берёт заголовки From/Subject/Date/Message-ID и текстовую
 * часть письма (`text/plain`, а если её нет — `text/html` с вырезанной разметкой).
 * Вложения и составные части кроме текста не разбираются — обращению нужен только
 * текст письма.
 *
 * Структура MIME (границы, заголовки) — всегда ASCII, поэтому всё письмо сначала
 * читается как `latin1` (побайтовая строка, обратимая в `Buffer` без потерь), и только
 * лист текста заново кодируется в `Buffer` и раскодируется по объявленной кодировке.
 */

export interface ParsedEmlAddress {
  name: string | null
  email: string
}

export interface ParsedEml {
  from: ParsedEmlAddress
  subject: string
  date: Date | null
  messageId: string | null
  bodyText: string
}

// ─────────────────────────── Заголовки ────────────────────────────────────

/** Разворачивает продолжения заголовка (строка начинается с пробела/табуляции). */
function unfoldHeaders(block: string): string {
  return block.replace(/\n[ \t]+/g, ' ')
}

function parseHeaderBlock(block: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of unfoldHeaders(block).split('\n')) {
    if (!line.trim()) continue
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    if (map.has(key)) continue // первое значение побеждает — как у большинства полей письма
    map.set(key, line.slice(idx + 1).trim())
  }
  return map
}

/** Первая пустая строка отделяет заголовки от тела — и всего письма, и части multipart. */
function splitMessage(raw: string): { headerBlock: string; body: string } {
  const normalized = raw.replace(/\r\n/g, '\n')
  const idx = normalized.indexOf('\n\n')
  if (idx === -1) return { headerBlock: normalized, body: '' }
  return { headerBlock: normalized.slice(0, idx), body: normalized.slice(idx + 2) }
}

/** `=?charset?Q|B?текст?=` (RFC 2047) — кодированные слова темы и имени отправителя. */
function decodeEncodedWords(text: string): string {
  return text.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=\s*(?==\?|$)?/g, (_match, charset: string, enc: string, data: string) => {
    try {
      if (enc.toLowerCase() === 'b') {
        return decodeBuffer(Buffer.from(data.replace(/\s+/g, ''), 'base64'), charset)
      }
      const withSpaces = data.replace(/_/g, ' ')
      return decodeBuffer(quotedPrintableToBuffer(withSpaces), charset)
    } catch {
      return data
    }
  })
}

// ─────────────────────────── Кодировки ────────────────────────────────────

function decodeBuffer(buf: Buffer, charset: string): string {
  const normalized = charset.trim().toLowerCase().replace(/^"|"$/g, '')
  if (normalized === '' || normalized === 'utf-8' || normalized === 'utf8' || normalized === 'us-ascii') {
    return buf.toString('utf-8')
  }
  try {
    return new TextDecoder(normalized).decode(buf)
  } catch {
    // Кодировка не поддержана сборкой Node (нет полного ICU) — латиница как запасной путь:
    // теряется точность для кириллицы не в UTF-8, но письмо не падает целиком.
    try {
      return buf.toString('utf-8')
    } catch {
      return buf.toString('latin1')
    }
  }
}

function quotedPrintableToBuffer(text: string): Buffer {
  const bytes: number[] = []
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '=') {
      if (text[i + 1] === '\n') {
        i += 1 // мягкий перенос строки — не часть текста
        continue
      }
      if (text[i + 1] === '\r' && text[i + 2] === '\n') {
        i += 2
        continue
      }
      const hex = text.slice(i + 1, i + 3)
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(Number.parseInt(hex, 16))
        i += 2
        continue
      }
    }
    bytes.push(ch!.charCodeAt(0) & 0xff)
  }
  return Buffer.from(bytes)
}

// ─────────────────────────── MIME-части ───────────────────────────────────

interface ContentType {
  type: string
  params: Record<string, string>
}

function parseContentType(header: string | undefined): ContentType {
  const [rawType, ...rest] = (header ?? 'text/plain').split(';')
  const params: Record<string, string> = {}
  for (const part of rest) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq).trim().toLowerCase()
    let value = part.slice(eq + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    params[key] = value
  }
  return { type: (rawType ?? 'text/plain').trim().toLowerCase(), params }
}

/** Части между `--boundary`: первый и «хвост» после закрывающего `--boundary--` отбрасываются. */
function splitMultipart(body: string, boundary: string): string[] {
  const marker = `--${boundary}`
  return body
    .split(marker)
    .slice(1)
    .filter((chunk) => !chunk.startsWith('--'))
    .map((chunk) => chunk.replace(/^\n/, '').replace(/\n$/, ''))
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Раскодированный лист части (`text/plain` или `text/html`) — не multipart. */
function decodeLeaf(headers: Map<string, string>, latin1Body: string): string {
  const cte = (headers.get('content-transfer-encoding') ?? '7bit').trim().toLowerCase()
  const { params } = parseContentType(headers.get('content-type'))
  const charset = params.charset ?? 'utf-8'
  const buf =
    cte === 'base64'
      ? Buffer.from(latin1Body.replace(/\s+/g, ''), 'base64')
      : cte === 'quoted-printable'
        ? quotedPrintableToBuffer(latin1Body)
        : Buffer.from(latin1Body, 'latin1')
  return decodeBuffer(buf, charset)
}

/** Текст письма — рекурсивно, если часть сама составная (`multipart/alternative` внутри `mixed`). */
function extractText(body: string, headers: Map<string, string>): string {
  const { type, params } = parseContentType(headers.get('content-type'))

  if (type.startsWith('multipart/') && params.boundary) {
    let htmlFallback: string | null = null
    for (const partRaw of splitMultipart(body, params.boundary)) {
      const { headerBlock, body: partBody } = splitMessage(partRaw)
      const partHeaders = parseHeaderBlock(headerBlock)
      const partType = parseContentType(partHeaders.get('content-type')).type

      if (partType.startsWith('multipart/')) {
        const nested = extractText(partBody, partHeaders)
        if (nested.trim()) return nested
        continue
      }
      if (partType === 'text/plain') return decodeLeaf(partHeaders, partBody)
      if (htmlFallback === null && partType === 'text/html') {
        htmlFallback = stripHtml(decodeLeaf(partHeaders, partBody))
      }
    }
    return htmlFallback ?? ''
  }

  if (type === 'text/html') return stripHtml(decodeLeaf(headers, body))
  return decodeLeaf(headers, body)
}

// ─────────────────────────── Адрес отправителя ────────────────────────────

/** `"Имя Фамилия" <a@b.ru>` или просто `a@b.ru`. */
function parseAddress(raw: string): ParsedEmlAddress {
  const decoded = decodeEncodedWords(raw).trim()
  const match = /^(.*)<([^>]+)>\s*$/.exec(decoded)
  if (match) {
    const name = match[1]!.trim().replace(/^"|"$/g, '').trim()
    return { name: name || null, email: (normalizeEmail(match[2]) ?? match[2]!.trim().toLowerCase()) }
  }
  return decoded ? { name: null, email: normalizeEmail(decoded) ?? decoded.toLowerCase() } : { name: null, email: '' }
}

// ─────────────────────────────── API ──────────────────────────────────────

/** Больше этого разбор не пытается: искажённый файл не должен вешать запрос. */
const MAX_PARSE_CHARS = 8 * 1024 * 1024

export function parseEml(bytes: Uint8Array): ParsedEml {
  const raw = Buffer.from(bytes).toString('latin1').slice(0, MAX_PARSE_CHARS)
  const { headerBlock, body } = splitMessage(raw)
  // Заголовки почти всегда ASCII (не по правилам — в UTF-8 напрямую, без кодированных
  // слов): в отличие от тела письма, у них нет объявленной кодировки, поэтому лучшее
  // приближение — UTF-8. `headerBlock` — латиница 1:1 с исходными байтами (см. выше),
  // так что байты восстанавливаются точно перед повторным раскодированием.
  const headers = parseHeaderBlock(Buffer.from(headerBlock, 'latin1').toString('utf-8'))

  const from = parseAddress(headers.get('from') ?? '')
  const subject = decodeEncodedWords(headers.get('subject') ?? '')
  const dateRaw = headers.get('date')
  const parsedDate = dateRaw ? new Date(dateRaw) : null
  const date = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null
  const messageIdRaw = headers.get('message-id')
  const messageId = messageIdRaw ? messageIdRaw.replace(/^<|>$/g, '').trim() || null : null

  return {
    from,
    subject,
    date,
    messageId,
    bodyText: extractText(body, headers).trim(),
  }
}
