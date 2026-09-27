import type { TelegramClient } from '@/integrations/telegram'
import { AppError } from '@/shared/http/errors'
import { log } from '@/shared/log/logger'
import { acceptStage } from '@/modules/workflow/workflow.service'
import { acceptLetter } from '@/modules/inbound-letters/inbound-letters.service'
import type { AcceptTarget } from '@/modules/notify-channels/notify-channels.types'
import * as repo from './telegram.repo'
import { ACCEPTED_MARK_DATA, acceptedEdit, acceptedLine, verifyAcceptData } from './telegram.actions'
import type { TelegramCallbackQuery } from './telegram.schema'

/**
 * Нажатие кнопки «Принял, беру в работу» (решение 200) — и в режиме вебхука,
 * и в режиме опроса: оба зовут `telegram.service.handleUpdate`, повторы одного
 * `update_id` отсеяны раньше (`acceptUpdate`, таблица telegram_updates_seen).
 *
 * Порядок проверок:
 * 1. нажатие из личного чата и нажал его владелец (в личке `from.id` = `chat.id`);
 * 2. чат привязан к активному пользователю SkillLink (`telegram_links`);
 * 3. подпись `callback_data` сходится с ЭТИМ чатом и ЭТИМ пользователем и срок не вышел;
 * 4. права на объект — те же, что в API (`acceptStage`, `acceptLetter`).
 *
 * Итог — всплывающий ответ (`answerCallbackQuery`) всегда, чтобы у кнопки не крутились
 * часики, и при успехе — правка сообщения: нажатая кнопка уходит, в тексте строка
 * «✓ Принято в работу, чч:мм». Исключений наружу нет.
 */

const clock = (date: Date): string =>
  new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(date)

export const CALLBACK_REPLIES = {
  accepted: 'Принято в работу. Отметка — в журнале SkillLink.',
  alreadyAccepted: (at: Date) => `Уже принято в работу в ${clock(at)}.`,
  alreadyMarked: 'Уже отмечено: принято в работу.',
  notPrivate: 'Кнопки работают только в личной переписке с ботом.',
  notLinked: 'Этот чат не подключён к SkillLink. Подключить — в личном кабинете: «Каналы уведомлений».',
  invalid: 'Кнопка недействительна для этого чата. Откройте SkillLink.',
  expired: 'Кнопка устарела. Откройте SkillLink или дождитесь новой сводки.',
  failed: 'Не получилось отметить. Попробуйте ещё раз позже или откройте SkillLink.',
} as const

interface Decision {
  text: string
  /** Окно с кнопкой «OK» вместо короткой подсказки — для отказов, их нужно прочесть. */
  alert: boolean
  /** Строка «✓ Принято…» для правки сообщения; нет — сообщение не меняется. */
  line?: string
}

async function accept(
  user: NonNullable<Awaited<ReturnType<typeof repo.findActiveUserByChat>>>,
  target: AcceptTarget,
  now: Date,
) {
  return target.type === 'stage'
    ? acceptStage(user, target.id, { source: 'telegram', now })
    : acceptLetter(user, target.id, { source: 'telegram', now })
}

async function decide(query: TelegramCallbackQuery, secret: string, now: Date): Promise<Decision> {
  const data = query.data
  const message = query.message
  if (data === ACCEPTED_MARK_DATA) return { text: CALLBACK_REPLIES.alreadyMarked, alert: false }
  if (!data || !message) return { text: CALLBACK_REPLIES.invalid, alert: true }
  if (message.chat.type !== 'private') return { text: CALLBACK_REPLIES.notPrivate, alert: true }

  const chatId = String(message.chat.id)
  // В личном чате нажать может только его владелец; иначе это не наш случай.
  if (String(query.from.id) !== chatId) return { text: CALLBACK_REPLIES.invalid, alert: true }

  const user = await repo.findActiveUserByChat(chatId)
  if (!user) return { text: CALLBACK_REPLIES.notLinked, alert: true }

  const check = verifyAcceptData(secret, data, { chatId, userId: user.id }, now.getTime())
  if (!check.ok) return { text: CALLBACK_REPLIES[check.reason], alert: true }

  try {
    const result = await accept(user, check.target, now)
    return {
      text: result.alreadyAccepted ? CALLBACK_REPLIES.alreadyAccepted(result.acceptedAt) : CALLBACK_REPLIES.accepted,
      alert: false,
      line: acceptedLine(result.acceptedAt, result.label),
    }
  } catch (error) {
    // Отказ правил (нет прав, эксперт, связка закрыта, этап не найден) — текстом
    // из API: он уже на русском и без подробностей о чужих данных.
    if (error instanceof AppError && error.status < 500) return { text: error.message, alert: true }
    log.error('[telegram] «Принял» не записано', { kind: check.target.type, err: error })
    return { text: CALLBACK_REPLIES.failed, alert: true }
  }
}

export async function handleCallbackQuery(
  query: TelegramCallbackQuery,
  options: { secret: string; client: TelegramClient; now: Date },
): Promise<void> {
  let decision: Decision
  try {
    decision = await decide(query, options.secret, options.now)
  } catch (error) {
    // Сбой базы на поиске привязки — ответить всё равно нужно, иначе у кнопки часики.
    log.error('[telegram] нажатие кнопки не разобрано', { err: error })
    decision = { text: CALLBACK_REPLIES.failed, alert: true }
  }

  await options.client.answerCallbackQuery(query.id, decision.text, { showAlert: decision.alert })

  const message = query.message
  if (!decision.line || !message || !query.data) return
  const edit = acceptedEdit(message, query.data, decision.line)
  const chatId = String(message.chat.id)
  // Сбой правки (например, «сообщение не изменилось» при двойном нажатии) клиент
  // пишет в журнал сам; отметка уже в базе, человек уже получил ответ.
  if (edit.kind === 'text') {
    await options.client.editMessageText(chatId, message.message_id, edit.text, edit.replyMarkup)
  } else {
    await options.client.editMessageReplyMarkup(chatId, message.message_id, edit.replyMarkup)
  }
}
