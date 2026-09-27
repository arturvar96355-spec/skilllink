import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import { TELEGRAM_DEFAULT_API_BASE, type TelegramConfig } from '@/integrations/config'
import { TelegramClient } from '@/integrations/telegram'
import { conflict, forbidden } from '@/shared/http/errors'
import { REVIEWER_FORBIDDEN_MESSAGE } from '@/shared/auth/permissions'
import { TELEGRAM_ACTIONS } from '@/shared/config/telegram.config'
import { ACCEPTED_MARK_DATA, ACTION_TEXTS, createAcceptData } from './telegram.actions'
import { CALLBACK_REPLIES } from './telegram.callbacks'
import { telegramUpdateSchema } from './telegram.schema'

/**
 * Нажатие «Принял, беру в работу» (решение 200) через общий обработчик обновлений
 * `handleUpdate` — тот же, что у вебхука и опроса. База, сервисы этапов и писем
 * и Telegram подменены: проверяется порядок проверок, ответ на нажатие и правка сообщения.
 */

const mocks = vi.hoisted(() => ({
  findActiveUserByChat: vi.fn(),
  acceptStage: vi.fn(),
  acceptLetter: vi.fn(),
  telegram: null as TelegramConfig | null,
}))

vi.mock('./telegram.repo', () => ({ findActiveUserByChat: mocks.findActiveUserByChat }))
vi.mock('@/modules/workflow/workflow.service', () => ({ acceptStage: mocks.acceptStage }))
vi.mock('@/modules/inbound-letters/inbound-letters.service', () => ({ acceptLetter: mocks.acceptLetter }))
vi.mock('@/integrations/config', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/integrations/config')>()
  return {
    ...original,
    getIntegrationsConfig: () => ({ ...original.getIntegrationsConfig(), telegram: mocks.telegram }),
  }
})

const service = await import('./telegram.service')

const SECRET = 'auth-secret'
const CHAT = 777
const STAGE_ID = 'cmstage0000000000000000001'
const LETTER_ID = 'cmletter000000000000000001'
const NOW = new Date('2026-09-28T11:05:00Z')
const manager: CurrentUser = {
  id: 'cmuser0manager000000000000',
  email: 'manager@example.test',
  fullName: 'Демо Менеджер',
  role: 'MANAGER',
  universityId: null,
}

function enabledConfig(): TelegramConfig {
  return {
    botToken: '1:T',
    botUsername: 'skilllink_bot',
    webhookSecret: 'hook',
    apiBase: TELEGRAM_DEFAULT_API_BASE,
    apiIp: null,
    timeoutMs: 1000,
    enabled: true,
    mode: 'webhook',
  }
}

/** Клиент Telegram, который запоминает ответы и правки вместо отправки. */
function fakeClient() {
  const client = new TelegramClient(enabledConfig())
  const answers = vi.spyOn(client, 'answerCallbackQuery').mockResolvedValue({ ok: true })
  const editText = vi.spyOn(client, 'editMessageText').mockResolvedValue({ ok: true })
  const editMarkup = vi.spyOn(client, 'editMessageReplyMarkup').mockResolvedValue({ ok: true })
  const send = vi.spyOn(client, 'sendMessage').mockResolvedValue({ ok: true })
  return { client, answers, editText, editMarkup, send }
}

function acceptData(target: { type: 'stage' | 'letter'; id: string }, chatId = String(CHAT), userId = manager.id, now = NOW) {
  return createAcceptData(SECRET, target, { chatId, userId }, now.getTime())!
}

let updateId = 1000
/** Обновление с нажатием — прогоняется через ту же схему, что вебхук и опрос. */
function press(
  data: string,
  options: { chatId?: number; fromId?: number; chatType?: string; text?: string | null } = {},
) {
  updateId += 1
  const chatId = options.chatId ?? CHAT
  const raw = {
    update_id: updateId,
    callback_query: {
      id: `cb-${updateId}`,
      from: { id: options.fromId ?? chatId, first_name: 'Иван', username: 'ivan' },
      message: {
        message_id: 42,
        chat: { id: chatId, type: options.chatType ?? 'private' },
        ...(options.text === null ? {} : { text: options.text ?? 'Новое письмо от вуза СПбГУТ: Встреча' }),
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Открыть', url: 'https://skilllink.example.test/letters/1' },
              { text: ACTION_TEXTS.accept, callback_data: data },
            ],
          ],
        },
      },
      data,
    },
  }
  return telegramUpdateSchema.parse(raw)
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) if (typeof mock === 'function') mock.mockReset()
  mocks.telegram = enabledConfig()
  mocks.findActiveUserByChat.mockResolvedValue(manager)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('«Принял, беру в работу»: успех и повтор', () => {
  it('этап принят: ответ на нажатие, кнопка уходит, в тексте строка «✓ Принято в работу, чч:мм»', async () => {
    mocks.acceptStage.mockResolvedValue({ acceptedAt: NOW, alreadyAccepted: false, label: 'этап 3 «Договор», СПбГУТ' })
    const { client, answers, editText, editMarkup } = fakeClient()
    const data = acceptData({ type: 'stage', id: STAGE_ID })

    await service.handleUpdate(press(data), { secret: SECRET, client, now: NOW })

    expect(mocks.findActiveUserByChat).toHaveBeenCalledWith('777')
    expect(mocks.acceptStage).toHaveBeenCalledWith(manager, STAGE_ID, { source: 'telegram', now: NOW })
    expect(answers).toHaveBeenCalledWith(expect.stringMatching(/^cb-/), CALLBACK_REPLIES.accepted, { showAlert: false })
    expect(editText).toHaveBeenCalledWith(
      '777',
      42,
      'Новое письмо от вуза СПбГУТ: Встреча\n\n✓ Принято в работу, 14:05 — этап 3 «Договор», СПбГУТ',
      { inline_keyboard: [[{ text: 'Открыть', url: 'https://skilllink.example.test/letters/1' }]] },
    )
    expect(editMarkup).not.toHaveBeenCalled()
  })

  it('письмо: вызывается сервис писем, строка без подписи объекта', async () => {
    mocks.acceptLetter.mockResolvedValue({ acceptedAt: NOW, alreadyAccepted: false, label: null })
    const { client, editText } = fakeClient()
    await service.handleUpdate(press(acceptData({ type: 'letter', id: LETTER_ID })), { secret: SECRET, client, now: NOW })

    expect(mocks.acceptLetter).toHaveBeenCalledWith(manager, LETTER_ID, { source: 'telegram', now: NOW })
    expect(mocks.acceptStage).not.toHaveBeenCalled()
    expect(editText.mock.calls[0]![2]).toMatch(/\n\n✓ Принято в работу, 14:05$/)
  })

  it('повторное нажатие идемпотентно: «уже принято в чч:мм» по времени первой отметки', async () => {
    const first = new Date('2026-09-28T06:30:00Z')
    mocks.acceptStage.mockResolvedValue({ acceptedAt: first, alreadyAccepted: true, label: 'этап 3 «Договор», СПбГУТ' })
    const { client, answers, editText } = fakeClient()
    await service.handleUpdate(press(acceptData({ type: 'stage', id: STAGE_ID })), { secret: SECRET, client, now: NOW })

    expect(answers).toHaveBeenCalledWith(expect.any(String), 'Уже принято в работу в 09:30.', { showAlert: false })
    // Сообщение приводится к тому же виду, что после первого нажатия.
    expect(editText.mock.calls[0]![2]).toContain('✓ Принято в работу, 09:30')
  })

  it('кнопка-отметка после запасной правки — только «уже отмечено», в базу не ходим', async () => {
    const { client, answers, editText } = fakeClient()
    await service.handleUpdate(press(ACCEPTED_MARK_DATA), { secret: SECRET, client, now: NOW })
    expect(answers).toHaveBeenCalledWith(expect.any(String), CALLBACK_REPLIES.alreadyMarked, { showAlert: false })
    expect(mocks.findActiveUserByChat).not.toHaveBeenCalled()
    expect(editText).not.toHaveBeenCalled()
  })

  it('текста у сообщения нет — правятся только кнопки: на месте нажатой встаёт отметка', async () => {
    mocks.acceptStage.mockResolvedValue({ acceptedAt: NOW, alreadyAccepted: false, label: null })
    const { client, editText, editMarkup } = fakeClient()
    await service.handleUpdate(press(acceptData({ type: 'stage', id: STAGE_ID }), { text: null }), {
      secret: SECRET,
      client,
      now: NOW,
    })
    expect(editText).not.toHaveBeenCalled()
    expect(editMarkup).toHaveBeenCalledWith('777', 42, {
      inline_keyboard: [
        [
          { text: 'Открыть', url: 'https://skilllink.example.test/letters/1' },
          { text: '✓ Принято в работу, 14:05', callback_data: ACCEPTED_MARK_DATA },
        ],
      ],
    })
  })
})

describe('«Принял»: отказы', () => {
  async function expectRefusal(update: ReturnType<typeof press>, text: string) {
    const { client, answers, editText, editMarkup, send } = fakeClient()
    await service.handleUpdate(update, { secret: SECRET, client, now: NOW })
    expect(answers).toHaveBeenCalledWith(expect.any(String), text, { showAlert: true })
    expect(editText).not.toHaveBeenCalled()
    expect(editMarkup).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  }

  it('подделанная подпись — invalid, сервис не зовётся', async () => {
    const data = acceptData({ type: 'stage', id: STAGE_ID })
    const forged = `${data.slice(0, 22)}cmstage0000000000000000002`
    await expectRefusal(press(forged), CALLBACK_REPLIES.invalid)
    expect(mocks.acceptStage).not.toHaveBeenCalled()
  })

  it('истёкшая кнопка — expired', async () => {
    const old = new Date(NOW.getTime() - TELEGRAM_ACTIONS.ttlMs - 60_000)
    await expectRefusal(press(acceptData({ type: 'stage', id: STAGE_ID }, '777', manager.id, old)), CALLBACK_REPLIES.expired)
    expect(mocks.acceptStage).not.toHaveBeenCalled()
  })

  it('кнопка из чужого чата (подписана для 777, нажата в 888) — invalid', async () => {
    const data = acceptData({ type: 'stage', id: STAGE_ID }, '777')
    await expectRefusal(press(data, { chatId: 888 }), CALLBACK_REPLIES.invalid)
    expect(mocks.acceptStage).not.toHaveBeenCalled()
  })

  it('чат перепривязан к другому сотруднику — подпись не сходится, invalid', async () => {
    mocks.findActiveUserByChat.mockResolvedValue({ ...manager, id: 'cmuser0other00000000000000' })
    await expectRefusal(press(acceptData({ type: 'stage', id: STAGE_ID })), CALLBACK_REPLIES.invalid)
    expect(mocks.acceptStage).not.toHaveBeenCalled()
  })

  it('нажал не владелец личного чата — invalid, в базу не ходим', async () => {
    await expectRefusal(press(acceptData({ type: 'stage', id: STAGE_ID }), { fromId: 999 }), CALLBACK_REPLIES.invalid)
    expect(mocks.findActiveUserByChat).not.toHaveBeenCalled()
  })

  it('чат не привязан или пользователь заблокирован — notLinked', async () => {
    mocks.findActiveUserByChat.mockResolvedValue(null)
    await expectRefusal(press(acceptData({ type: 'stage', id: STAGE_ID })), CALLBACK_REPLIES.notLinked)
  })

  it('группа — только в личной переписке', async () => {
    await expectRefusal(
      press(acceptData({ type: 'stage', id: STAGE_ID }), { chatId: -100, fromId: 5, chatType: 'supergroup' }),
      CALLBACK_REPLIES.notPrivate,
    )
  })

  it('эксперт — отказ текстом из API, отметки нет', async () => {
    mocks.findActiveUserByChat.mockResolvedValue({ ...manager, isReviewer: true })
    mocks.acceptStage.mockRejectedValue(forbidden(REVIEWER_FORBIDDEN_MESSAGE))
    await expectRefusal(press(acceptData({ type: 'stage', id: STAGE_ID })), REVIEWER_FORBIDDEN_MESSAGE)
    expect(mocks.acceptStage).toHaveBeenCalledWith(expect.objectContaining({ isReviewer: true }), STAGE_ID, expect.anything())
  })

  it('этап закрыт — текст правила (409)', async () => {
    mocks.acceptStage.mockRejectedValue(conflict('Этап уже закрыт — принимать в работу нечего'))
    await expectRefusal(press(acceptData({ type: 'stage', id: STAGE_ID })), 'Этап уже закрыт — принимать в работу нечего')
  })

  it('сбой базы — «не получилось», но ответ на нажатие всё равно уходит', async () => {
    mocks.findActiveUserByChat.mockRejectedValue(new Error('база недоступна'))
    await expectRefusal(press(acceptData({ type: 'stage', id: STAGE_ID })), CALLBACK_REPLIES.failed)
    mocks.findActiveUserByChat.mockResolvedValue(manager)
    mocks.acceptStage.mockRejectedValue(new Error('сбой записи'))
    await expectRefusal(press(acceptData({ type: 'stage', id: STAGE_ID })), CALLBACK_REPLIES.failed)
  })

  it('бот не настроен — нажатие не обрабатывается', async () => {
    mocks.telegram = { ...enabledConfig(), botToken: null, enabled: false }
    const { client, answers } = fakeClient()
    await service.handleUpdate(press(acceptData({ type: 'stage', id: STAGE_ID })), { secret: SECRET, client, now: NOW })
    expect(answers).not.toHaveBeenCalled()
  })
})
