import { afterEach, describe, expect, it, vi } from 'vitest'
import { TELEGRAM_ACTIONS } from '@/shared/config/telegram.config'
import type { MessageAction } from '@/modules/notify-channels/notify-channels.types'
import {
  ACCEPTED_MARK_DATA,
  ACTION_TEXTS,
  acceptedEdit,
  acceptedLine,
  actionSigningSecret,
  createAcceptData,
  toInlineKeyboard,
  verifyAcceptData,
} from './telegram.actions'
import { buildDigest, type DigestStageSource } from './telegram.rules'

/**
 * Кнопки в сообщениях бота (решение 200): подпись `callback_data`, раскладка кнопок,
 * правка сообщения после «Принял» и кнопки сводки. Чистые функции — без базы и сети.
 */

const SECRET = 'auth-secret'
const STAGE_ID = 'cmstage0000000000000000001'
const binding = { chatId: '777', userId: 'cmuser0manager000000000000' }
const NOW = Date.parse('2026-09-28T09:00:00Z')

describe('callback_data «Принял»: подпись и проверка', () => {
  it('укладывается в 64 байта, без персональных данных — только вид и id объекта', () => {
    const data = createAcceptData(SECRET, { type: 'stage', id: STAGE_ID }, binding, NOW)!
    expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64)
    expect(data).toMatch(/^as[A-Za-z0-9_-]{20}cmstage0000000000000000001$/)
    // Ни чата, ни пользователя в открытом виде: они только в подписи.
    expect(data).not.toContain('777')
    expect(data).not.toContain(binding.userId)
  })

  it('своя кнопка в своём чате — проходит и называет объект', () => {
    const data = createAcceptData(SECRET, { type: 'letter', id: 'cmletter000000000000000001' }, binding, NOW)!
    expect(verifyAcceptData(SECRET, data, binding, NOW + 60_000)).toEqual({
      ok: true,
      target: { type: 'letter', id: 'cmletter000000000000000001' },
    })
  })

  it('подделка: другой id, другой вид, испорченная подпись, чужой секрет — invalid', () => {
    const data = createAcceptData(SECRET, { type: 'stage', id: STAGE_ID }, binding, NOW)!
    const otherId = `${data.slice(0, 22)}cmstage0000000000000000002`
    const otherKind = `al${data.slice(2)}`
    const brokenMac = `${data.slice(0, 10)}${data[10] === 'A' ? 'B' : 'A'}${data.slice(11)}`
    for (const forged of [otherId, otherKind, brokenMac]) {
      expect(verifyAcceptData(SECRET, forged, binding, NOW)).toEqual({ ok: false, reason: 'invalid' })
    }
    expect(verifyAcceptData('другой-секрет', data, binding, NOW)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('чужой чат или чат, перепривязанный к другому сотруднику, — invalid', () => {
    const data = createAcceptData(SECRET, { type: 'stage', id: STAGE_ID }, binding, NOW)!
    expect(verifyAcceptData(SECRET, data, { ...binding, chatId: '888' }, NOW)).toEqual({ ok: false, reason: 'invalid' })
    expect(verifyAcceptData(SECRET, data, { ...binding, userId: 'cmuser0other00000000000000' }, NOW)).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  it('истёкшая кнопка — expired; подделка с истёкшим сроком — всё равно invalid', () => {
    const data = createAcceptData(SECRET, { type: 'stage', id: STAGE_ID }, binding, NOW)!
    const later = NOW + TELEGRAM_ACTIONS.ttlMs + 1000
    expect(verifyAcceptData(SECRET, data, binding, later)).toEqual({ ok: false, reason: 'expired' })
    expect(verifyAcceptData(SECRET, data, { ...binding, chatId: '1' }, later)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('мусор и чужие форматы — invalid, без исключений', () => {
    for (const garbage of ['', 'a', ACCEPTED_MARK_DATA, 'x'.repeat(64), 'as!!!!!!!!!!!!!!!!!!!!cmstage', `as${'A'.repeat(20)}${'b'.repeat(43)}`]) {
      expect(verifyAcceptData(SECRET, garbage, binding, NOW)).toEqual({ ok: false, reason: 'invalid' })
    }
  })

  it('id длиннее предела или с чужими знаками — кнопку не выпускает', () => {
    expect(createAcceptData(SECRET, { type: 'stage', id: 'x'.repeat(43) }, binding, NOW)).toBeNull()
    expect(createAcceptData(SECRET, { type: 'stage', id: 'id с пробелом' }, binding, NOW)).toBeNull()
    expect(createAcceptData(SECRET, { type: 'stage', id: '' }, binding, NOW)).toBeNull()
  })
})

describe('секрет подписи при отправке', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('AUTH_SECRET задан — он; нет и это не разработка — кнопок «Принял» нет (null)', () => {
    vi.stubEnv('AUTH_SECRET', 's3cret')
    expect(actionSigningSecret()).toBe('s3cret')
    vi.stubEnv('AUTH_SECRET', '')
    vi.stubEnv('NODE_ENV', 'production')
    expect(actionSigningSecret()).toBeNull()
    vi.stubEnv('NODE_ENV', 'test')
    expect(actionSigningSecret()).toEqual(expect.any(String))
  })
})

describe('клавиатура Telegram из кнопок канала', () => {
  const actions: MessageAction[][] = [
    [
      { kind: 'open', text: '↗ Этап 3 · СПбГУТ', url: 'https://skilllink.example.test/cooperations/c1?stage=s1' },
      { kind: 'accept', text: ACTION_TEXTS.accept, target: { type: 'stage', id: STAGE_ID } },
    ],
  ]

  it('«Открыть» — ссылкой, «Принял» — подписанным обратным вызовом для этого чата и адресата', () => {
    const keyboard = toInlineKeyboard(actions, { secret: SECRET, ...binding, now: NOW })!
    expect(keyboard.inline_keyboard).toHaveLength(1)
    const [open, accept] = keyboard.inline_keyboard[0]!
    expect(open).toEqual({ text: '↗ Этап 3 · СПбГУТ', url: 'https://skilllink.example.test/cooperations/c1?stage=s1' })
    expect(accept).toMatchObject({ text: '✓ Принял, беру в работу' })
    const data = (accept as { callback_data: string }).callback_data
    expect(verifyAcceptData(SECRET, data, binding, NOW)).toMatchObject({ ok: true, target: { type: 'stage', id: STAGE_ID } })
  })

  it('без секрета или без адресата — только ссылки; ничего не осталось — без клавиатуры', () => {
    expect(toInlineKeyboard(actions, { secret: null, ...binding })!.inline_keyboard[0]).toHaveLength(1)
    expect(toInlineKeyboard(actions, { secret: SECRET, chatId: '777', userId: undefined })!.inline_keyboard[0]).toHaveLength(1)
    expect(toInlineKeyboard([[actions[0]![1]!]], { secret: null, ...binding })).toBeUndefined()
    expect(toInlineKeyboard(undefined, { secret: SECRET, ...binding })).toBeUndefined()
  })

  it('ссылку на свою машину Telegram не примет — кнопки «Открыть» нет, «Принял» остаётся', () => {
    const local: MessageAction[][] = [[{ ...actions[0]![0]!, url: 'http://localhost:3000/letters/1' } as MessageAction, actions[0]![1]!]]
    const keyboard = toInlineKeyboard(local, { secret: SECRET, ...binding })!
    expect(keyboard.inline_keyboard[0]).toHaveLength(1)
    expect(keyboard.inline_keyboard[0]![0]).toHaveProperty('callback_data')
  })
})

describe('правка сообщения после «Принял»', () => {
  const pressed = 'as_pressed'
  const markup = {
    inline_keyboard: [
      [
        { text: '↗ Этап 3 · СПбГУТ', url: 'https://x.test/c/1' },
        { text: ACTION_TEXTS.accept, callback_data: pressed },
      ],
      [
        { text: '↗ Этап 5 · МГУ', url: 'https://x.test/c/2' },
        { text: ACTION_TEXTS.accept, callback_data: 'as_other' },
      ],
    ],
  }
  const line = acceptedLine(new Date('2026-09-28T11:05:00Z'), 'этап 3 «Договор», СПбГУТ')

  it('строка «✓ Принято в работу, чч:мм» по Москве, с подписью объекта', () => {
    expect(line).toBe('✓ Принято в работу, 14:05 — этап 3 «Договор», СПбГУТ')
    expect(acceptedLine(new Date('2026-09-28T11:05:00Z'), null)).toBe('✓ Принято в работу, 14:05')
  })

  it('нажатая кнопка уходит, строка — в конец текста, остальные кнопки на месте', () => {
    const edit = acceptedEdit({ text: 'Сводка', reply_markup: markup }, pressed, line)
    expect(edit).toEqual({
      kind: 'text',
      text: `Сводка\n\n${line}`,
      replyMarkup: {
        inline_keyboard: [
          [{ text: '↗ Этап 3 · СПбГУТ', url: 'https://x.test/c/1' }],
          [
            { text: '↗ Этап 5 · МГУ', url: 'https://x.test/c/2' },
            { text: ACTION_TEXTS.accept, callback_data: 'as_other' },
          ],
        ],
      },
    })
  })

  it('повтор той же правки строку не дублирует', () => {
    const edit = acceptedEdit({ text: `Сводка\n\n${line}`, reply_markup: markup }, pressed, line)
    expect(edit.kind === 'text' && edit.text).toBe(`Сводка\n\n${line}`)
  })

  it('текста нет или он не помещается — на месте кнопки встаёт отметка, текст не трогается', () => {
    for (const text of [undefined, 'x'.repeat(4096)]) {
      const edit = acceptedEdit({ text, reply_markup: markup }, pressed, line)
      expect(edit.kind).toBe('markup')
      expect(edit.replyMarkup.inline_keyboard[0]![1]).toEqual({ text: line, callback_data: ACCEPTED_MARK_DATA })
      expect(edit.replyMarkup.inline_keyboard[1]).toEqual(markup.inline_keyboard[1])
    }
  })
})

describe('кнопки сводки', () => {
  const now = new Date('2026-09-28T09:00:00Z')
  function stage(n: number, overrides: Partial<DigestStageSource> = {}): DigestStageSource {
    return {
      stageId: `cmstage00000000000000000${String(n).padStart(2, '0')}`,
      stageNumber: 3,
      stageTitle: 'Договор',
      status: 'IN_PROGRESS',
      deadline: new Date('2026-09-20T00:00:00Z'),
      cooperationId: `coop-${n}`,
      universityName: 'СПбГУТ',
      programName: 'Программа',
      siblings: [],
      ...overrides,
    }
  }

  it('строка на этап из текста: «↗ Этап N · вуз» со ссылкой на этап и «Принял»', () => {
    const digest = buildDigest({ stages: [stage(1)], recommendations: [] }, { now, baseUrl: 'https://skilllink.example.test' })
    expect(digest.actions).toEqual([
      [
        { kind: 'open', text: '↗ Этап 3 · СПбГУТ', url: 'https://skilllink.example.test/cooperations/coop-1?stage=cmstage0000000000000000001' },
        { kind: 'accept', text: ACTION_TEXTS.accept, target: { type: 'stage', id: 'cmstage0000000000000000001' } },
      ],
    ])
  })

  it('не больше digestStagesMax строк, в порядке текста: сначала просроченные, потом скоро срок', () => {
    const overdue = Array.from({ length: 4 }, (_, i) => stage(i + 1))
    const soon = Array.from({ length: 4 }, (_, i) =>
      stage(i + 10, { deadline: new Date('2026-09-29T12:00:00Z') }),
    )
    const digest = buildDigest({ stages: [...soon, ...overdue], recommendations: [] }, { now, baseUrl: 'https://x.test' })
    expect(digest.actions).toHaveLength(TELEGRAM_ACTIONS.digestStagesMax)
    const ids = digest.actions.map((row) => (row[1] as { target: { id: string } }).target.id)
    expect(ids.slice(0, 4)).toEqual(overdue.map((row) => row.stageId))
    expect(ids[4]).toBe(soon[0]!.stageId)
  })

  it('без адреса стенда — одна кнопка «Принял» с номером этапа и вузом', () => {
    const digest = buildDigest({ stages: [stage(1)], recommendations: [] }, { now, baseUrl: null })
    expect(digest.actions).toEqual([
      [{ kind: 'accept', text: '✓ Принял: этап 3 · СПбГУТ', target: { type: 'stage', id: 'cmstage0000000000000000001' } }],
    ])
  })

  it('пустая сводка — без кнопок', () => {
    expect(buildDigest({ stages: [], recommendations: [] }, { now, baseUrl: null }).actions).toEqual([])
  })
})
