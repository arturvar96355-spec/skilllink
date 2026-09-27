import { createHmac, timingSafeEqual } from 'node:crypto'
import { resolveSecret } from '@/shared/auth/secret'
import { TELEGRAM_ACTIONS } from '@/shared/config/telegram.config'
import type { TelegramInlineButton, TelegramInlineKeyboard } from '@/integrations/telegram/telegram.client'
import { TELEGRAM_MAX_TEXT } from '@/integrations/telegram/telegram.client'
import type { AcceptTarget, MessageAction } from '@/modules/notify-channels/notify-channels.types'
export { ACTION_TEXTS } from '@/modules/notify-channels/notify-channels.types'

/**
 * Кнопки в сообщениях бота (решение 200): «Открыть» — ссылка на страницу SkillLink,
 * «Принял, беру в работу» — обратный вызов с подписанным `callback_data`.
 *
 * Чистые функции без базы и сети: подпись и проверка кнопки, раскладка кнопок
 * в разметку Telegram, правка сообщения после нажатия. Что значит «принял»
 * и кому можно, решают сервисы этапов и писем (`acceptStage`, `acceptLetter`).
 *
 * **Формат `callback_data`** (до 64 байт — предел Bot API), без персональных данных:
 *
 *     a <вид> <20 знаков base64url: 4 байта срока + 11 байт HMAC> <id объекта>
 *
 * `a` — версия формата, вид — `s` (этап) или `l` (письмо), id — cuid из 25 знаков:
 * всего 47 знаков. HMAC-SHA-256 на ключе, производном от AUTH_SECRET (как токен
 * привязки, решение 102), считается от вида, id, срока, **чата и пользователя**:
 * кнопка из чужого чата или чата, перепривязанного к другому сотруднику, не
 * сойдётся по подписи. 88 бит подписи: подобрать её перебором через Telegram
 * за неделю жизни кнопки нельзя, а длина важнее.
 */

const VERSION = 'a'
const EXPIRY_BYTES = 4
const MAC_BYTES = 11
/** 15 байт → ровно 20 знаков base64url без выравнивания. */
const SIGNATURE_CHARS = 20
const HEADER_CHARS = 2 + SIGNATURE_CHARS
const OBJECT_ID_PATTERN = /^[A-Za-z0-9_-]+$/
const MAX_OBJECT_ID = TELEGRAM_ACTIONS.maxCallbackDataLength - HEADER_CHARS

const KIND_CHARS: Record<AcceptTarget['type'], string> = { stage: 's', letter: 'l' }
const KIND_BY_CHAR: Record<string, AcceptTarget['type']> = { s: 'stage', l: 'letter' }

/**
 * `callback_data` кнопки, уже превращённой в отметку «✓ Принято» (запасной путь правки,
 * когда текст сообщения недоступен): нажатие на неё только отвечает «уже отмечено».
 */
export const ACCEPTED_MARK_DATA = 'a:done'

export interface ActionBinding {
  /** Чат, куда уходит сообщение с кнопкой, — строкой, как в telegram_links. */
  chatId: string
  /** Пользователь SkillLink, которому оно адресовано. */
  userId: string
}

const actionKey = (secret: string): Buffer => createHmac('sha256', secret).update('skilllink:telegram-action').digest()

function mac(secret: string, kind: string, objectId: string, expiresAtSec: number, binding: ActionBinding): Buffer {
  return createHmac('sha256', actionKey(secret))
    .update(`${kind}.${objectId}.${expiresAtSec}.${binding.chatId}.${binding.userId}`)
    .digest()
    .subarray(0, MAC_BYTES)
}

/**
 * Подписанный `callback_data` кнопки «Принял». null — id объекта не того вида
 * (длиннее предела или с чужими знаками): такая кнопка просто не рисуется.
 */
export function createAcceptData(
  secret: string,
  target: AcceptTarget,
  binding: ActionBinding,
  now = Date.now(),
): string | null {
  if (target.id.length === 0 || target.id.length > MAX_OBJECT_ID || !OBJECT_ID_PATTERN.test(target.id)) return null
  const kind = KIND_CHARS[target.type]
  const expiresAtSec = Math.floor((now + TELEGRAM_ACTIONS.ttlMs) / 1000)
  const expiry = Buffer.alloc(EXPIRY_BYTES)
  expiry.writeUInt32BE(expiresAtSec)
  const signature = Buffer.concat([expiry, mac(secret, kind, target.id, expiresAtSec, binding)]).toString('base64url')
  return `${VERSION}${kind}${signature}${target.id}`
}

export type AcceptDataCheck =
  | { ok: true; target: AcceptTarget }
  | {
      ok: false
      /** `invalid` — не наш формат, подделка, чужой чат или пользователь; `expired` — срок вышел. */
      reason: 'invalid' | 'expired'
    }

/**
 * Проверить `callback_data` кнопки «Принял» против чата, где её нажали, и пользователя,
 * к которому этот чат привязан сейчас. Сначала подпись, потом срок: подделка
 * с истёкшим сроком — `invalid`, а не подсказка «обновите кнопку».
 */
export function verifyAcceptData(
  secret: string,
  data: string,
  binding: ActionBinding,
  now = Date.now(),
): AcceptDataCheck {
  if (data.length <= HEADER_CHARS || data.length > TELEGRAM_ACTIONS.maxCallbackDataLength) return { ok: false, reason: 'invalid' }
  if (data[0] !== VERSION) return { ok: false, reason: 'invalid' }
  const type = KIND_BY_CHAR[data[1]!]
  if (!type) return { ok: false, reason: 'invalid' }
  const signatureText = data.slice(2, HEADER_CHARS)
  const objectId = data.slice(HEADER_CHARS)
  if (!OBJECT_ID_PATTERN.test(signatureText) || !OBJECT_ID_PATTERN.test(objectId)) return { ok: false, reason: 'invalid' }

  const bytes = Buffer.from(signatureText, 'base64url')
  if (bytes.length !== EXPIRY_BYTES + MAC_BYTES) return { ok: false, reason: 'invalid' }
  const expiresAtSec = bytes.readUInt32BE(0)
  const received = bytes.subarray(EXPIRY_BYTES)
  if (!timingSafeEqual(received, mac(secret, data[1]!, objectId, expiresAtSec, binding))) {
    return { ok: false, reason: 'invalid' }
  }
  const expiresAtMs = expiresAtSec * 1000
  // Срок дальше, чем выдаёт сервер, с верной подписью бывает только при смене TTL
  // в сторону уменьшения — такую кнопку считаем устаревшей, а не вечной.
  if (expiresAtMs <= now || expiresAtMs > now + TELEGRAM_ACTIONS.ttlMs + 60_000) return { ok: false, reason: 'expired' }
  return { ok: true, target: { type, id: objectId } }
}

/**
 * Секрет подписи кнопок при ОТПРАВКЕ — тот же AUTH_SECRET, которым вебхук проверит
 * нажатие. Задан явно — он; при разработке и в тестах — секрет разработки из
 * `resolveSecret`. В остальных случаях (например, контейнер рассылки без AUTH_SECRET)
 * — null: кнопка «Принял» с чужим ключом всегда отвечала бы «недействительна», честнее
 * её не рисовать, ссылки «Открыть» остаются.
 */
export function actionSigningSecret(): string | null {
  const fromEnv = process.env.AUTH_SECRET
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv
  const mode = process.env.NODE_ENV
  if (mode === 'development' || mode === 'test') return resolveSecret()
  return null
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0'])

/**
 * Ссылку кнопки Telegram проверяет сам и за кривую отвергает сообщение целиком
 * (400): только http/https и не адрес своей машины — на локальном стенде кнопки
 * «Открыть» просто нет, «Принял» остаётся.
 */
function isButtonUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && !LOCAL_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}

/**
 * Кнопки канала → разметка Telegram. Ссылки — как есть, если Telegram их примет
 * (`isButtonUrl`). «Принял» — только когда
 * есть секрет и адресат: без них кнопка не рисуется. Пустые строки выбрасываются;
 * ничего не осталось — undefined, сообщение уходит без клавиатуры.
 */
export function toInlineKeyboard(
  actions: readonly (readonly MessageAction[])[] | undefined,
  context: { secret: string | null; chatId: string; userId: string | null | undefined; now?: number },
): TelegramInlineKeyboard | undefined {
  if (!actions || actions.length === 0) return undefined
  const rows: TelegramInlineButton[][] = []
  for (const row of actions) {
    const buttons: TelegramInlineButton[] = []
    for (const action of row) {
      if (action.kind === 'open') {
        if (isButtonUrl(action.url)) buttons.push({ text: action.text, url: action.url })
        continue
      }
      if (!context.secret || !context.userId) continue
      const data = createAcceptData(
        context.secret,
        action.target,
        { chatId: context.chatId, userId: context.userId },
        context.now,
      )
      if (data) buttons.push({ text: action.text, callback_data: data })
    }
    if (buttons.length > 0) rows.push(buttons)
  }
  return rows.length > 0 ? { inline_keyboard: rows } : undefined
}

/** Те же кнопки без «Принял» — для тех, кому отметка не разрешена; пустые строки уходят. */
export function withoutAcceptActions(actions: readonly (readonly MessageAction[])[]): MessageAction[][] {
  return actions.map((row) => row.filter((action) => action.kind !== 'accept')).filter((row) => row.length > 0)
}

// ─────────────────────────── Подписи кнопок ───────────────────────────

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** «↗ Этап 3 · СПбГУТ» — короткая подпись, текст пункта длинный и уже есть в сообщении. */
export function openStageText(stageNumber: number, universityName: string): string {
  return clip(`↗ Этап ${stageNumber} · ${universityName}`, TELEGRAM_ACTIONS.buttonLabelMax)
}

/** «✓ Принял: этап 3 · СПбГУТ» — когда рядом нет кнопки «Открыть» с номером этапа. */
export function acceptStageText(stageNumber: number, universityName: string): string {
  return clip(`✓ Принял: этап ${stageNumber} · ${universityName}`, TELEGRAM_ACTIONS.buttonLabelMax)
}

// ─────────────────────────── После нажатия ───────────────────────────

const clock = (date: Date): string =>
  new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(date)

/** «✓ Принято в работу, 14:05» и, если в сообщении несколько объектов, — какой именно. */
export function acceptedLine(acceptedAt: Date, label: string | null): string {
  return `✓ Принято в работу, ${clock(acceptedAt)}${label ? ` — ${label}` : ''}`
}

export type MessageEdit =
  | { kind: 'text'; text: string; replyMarkup: TelegramInlineKeyboard }
  | { kind: 'markup'; replyMarkup: TelegramInlineKeyboard }

/** Кнопка, как её возвращает Telegram в нажатии (`telegram.schema.ts`). */
export interface ReceivedButton {
  text: string
  url?: string
  callback_data?: string
}

/** Обратно в разметку для правки; кнопку без ссылки и без данных Telegram не примет — её нет. */
function toButton(button: ReceivedButton): TelegramInlineButton | null {
  if (button.url !== undefined) return { text: button.text, url: button.url }
  if (button.callback_data !== undefined) return { text: button.text, callback_data: button.callback_data }
  return null
}

function keyboardOf(rows: ReceivedButton[][]): TelegramInlineKeyboard {
  return {
    inline_keyboard: rows
      .map((row) => row.map(toButton).filter((button): button is TelegramInlineButton => button !== null))
      .filter((row) => row.length > 0),
  }
}

/**
 * Как поправить сообщение после «Принял»: нажатая кнопка уходит, в конец текста
 * добавляется строка «✓ Принято в работу, чч:мм», остальные кнопки остаются.
 * Текст недоступен (старое или удалённое сообщение) или с добавкой не помещается
 * в 4096 знаков — меняются только кнопки: на месте нажатой встаёт та же строка
 * кнопкой-отметкой. Уже отмеченная строка второй раз не добавляется.
 */
export function acceptedEdit(
  message: { text?: string; reply_markup?: { inline_keyboard: ReceivedButton[][] } },
  pressedData: string,
  line: string,
): MessageEdit {
  const rows = message.reply_markup?.inline_keyboard ?? []
  const text = message.text
  if (text !== undefined && text.length > 0) {
    const nextText = text.includes(line) ? text : `${text}\n\n${line}`
    if (nextText.length <= TELEGRAM_MAX_TEXT) {
      const without = rows.map((row) => row.filter((button) => button.callback_data !== pressedData))
      return { kind: 'text', text: nextText, replyMarkup: keyboardOf(without) }
    }
  }
  const marked = rows.map((row) =>
    row.map((button) =>
      button.callback_data === pressedData ? { text: line, callback_data: ACCEPTED_MARK_DATA } : button,
    ),
  )
  return { kind: 'markup', replyMarkup: keyboardOf(marked) }
}

/** Сколько кнопок «Принял» в сообщении — если больше одной, строке нужна подпись объекта. */
export function acceptButtonsCount(markup: { inline_keyboard: ReceivedButton[][] } | undefined): number {
  if (!markup) return 0
  return markup.inline_keyboard
    .flat()
    .filter((button) => button.callback_data !== undefined && button.callback_data !== ACCEPTED_MARK_DATA).length
}
