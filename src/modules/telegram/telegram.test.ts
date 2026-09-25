import { beforeEach, describe, expect, it } from 'vitest'
import { TELEGRAM_DIGEST, TELEGRAM_LINK } from '@/shared/config/telegram.config'
import { isAllowedOrigin } from '@/shared/http/origin'
import {
  consumeLinkToken,
  createLinkToken,
  isWebhookSecretValid,
  resetSpentLinkTokens,
  verifyLinkToken,
} from './telegram.link-token'
import {
  buildDigest,
  parseCommand,
  type DigestRecommendationSource,
  type DigestSources,
  type DigestStageSource,
} from './telegram.rules'
import { telegramUpdateSchema } from './telegram.schema'

const SECRET = 'test-auth-secret'
const USER = 'cmuh0aasx00h0r6rldyb5oacv'
const OTHER = 'cmuh0aasx00h0r6rldyb5zzzz'
const now = Date.parse('2026-09-25T09:00:00Z')

beforeEach(() => resetSpentLinkTokens())

describe('токен привязки', () => {
  it('короче 64 символов и только из алфавита start-параметра Telegram', () => {
    const { token, expiresAt } = createLinkToken(SECRET, USER, now)
    expect(token.length).toBeLessThanOrEqual(64)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(expiresAt.getTime()).toBe(Math.floor((now + TELEGRAM_LINK.ttlMs) / 1000) * 1000)
  })

  it('верный токен отдаёт своего пользователя', () => {
    const { token } = createLinkToken(SECRET, USER, now)
    expect(verifyLinkToken(SECRET, token, now + 60_000)?.userId).toBe(USER)
  })

  it('через 15 минут не действует', () => {
    const { token } = createLinkToken(SECRET, USER, now)
    expect(verifyLinkToken(SECRET, token, now + TELEGRAM_LINK.ttlMs - 1000)).not.toBeNull()
    expect(verifyLinkToken(SECRET, token, now + TELEGRAM_LINK.ttlMs + 1000)).toBeNull()
  })

  it('подписан другим секретом — не действует', () => {
    const { token } = createLinkToken('другой секрет', USER, now)
    expect(verifyLinkToken(SECRET, token, now)).toBeNull()
  })

  it('id пользователя в токене нельзя подменить на чужой', () => {
    const { token } = createLinkToken(SECRET, USER, now)
    const bytes = Buffer.from(token, 'base64url')
    const forged = Buffer.concat([bytes.subarray(0, 16), Buffer.from(OTHER)]).toString('base64url')
    expect(verifyLinkToken(SECRET, forged, now)).toBeNull()
  })

  it('срок нельзя продлить: подпись закрывает и его', () => {
    const { token } = createLinkToken(SECRET, USER, now)
    const bytes = Buffer.from(token, 'base64url')
    bytes.writeUInt32BE(bytes.readUInt32BE(0) + 60)
    expect(verifyLinkToken(SECRET, bytes.toString('base64url'), now)).toBeNull()
  })

  it('мусор, пустая строка и слишком длинное — не токен', () => {
    for (const junk of ['', 'abc', '../../etc', 'x'.repeat(65), 'a b c', 'AAAAAAAAAAAAAAAAAAAAAAAA']) {
      expect(verifyLinkToken(SECRET, junk, now)).toBeNull()
    }
  })

  it('срабатывает один раз', () => {
    const { token } = createLinkToken(SECRET, USER, now)
    expect(consumeLinkToken(SECRET, token, now)?.userId).toBe(USER)
    expect(consumeLinkToken(SECRET, token, now)).toBeNull()
  })
})

describe('секрет вебхука', () => {
  it('совпадает — да; другой, пустой или без заголовка — нет', () => {
    expect(isWebhookSecretValid('s3cret', 's3cret')).toBe(true)
    expect(isWebhookSecretValid('s3creT', 's3cret')).toBe(false)
    expect(isWebhookSecretValid('s3cret-longer', 's3cret')).toBe(false)
    expect(isWebhookSecretValid('', 's3cret')).toBe(false)
    expect(isWebhookSecretValid(null, 's3cret')).toBe(false)
  })

  it('секрет не задан — вебхук закрыт для всех, даже без заголовка', () => {
    expect(isWebhookSecretValid(null, null)).toBe(false)
    expect(isWebhookSecretValid('', null)).toBe(false)
    expect(isWebhookSecretValid('anything', null)).toBe(false)
  })

  it('запрос Telegram без Origin проходит проверку same-origin, чужой сайт — нет', () => {
    const base = { method: 'POST', hosts: ['skilllink.example'], siteUrl: 'https://skilllink.example' }
    expect(isAllowedOrigin({ ...base, origin: null })).toBe(true)
    expect(isAllowedOrigin({ ...base, origin: 'https://evil.example' })).toBe(false)
  })
})

describe('команды бота', () => {
  it('/start с токеном и без', () => {
    expect(parseCommand('/start abc_DEF-1', 'skilllink_bot')).toEqual({ kind: 'start', token: 'abc_DEF-1' })
    expect(parseCommand('/start', 'skilllink_bot')).toEqual({ kind: 'start', token: null })
    expect(parseCommand('  /start   tok  ', 'skilllink_bot')).toEqual({ kind: 'start', token: 'tok' })
  })

  it('/today и /stop, в том числе с именем бота и в другом регистре', () => {
    expect(parseCommand('/today', 'skilllink_bot')).toEqual({ kind: 'today' })
    expect(parseCommand('/TODAY@SkillLink_Bot', 'skilllink_bot')).toEqual({ kind: 'today' })
    expect(parseCommand('/stop', null)).toEqual({ kind: 'stop' })
  })

  it('команда другому боту, неизвестная команда и просто текст — справка', () => {
    expect(parseCommand('/today@other_bot', 'skilllink_bot')).toEqual({ kind: 'help' })
    expect(parseCommand('/help', 'skilllink_bot')).toEqual({ kind: 'help' })
    expect(parseCommand('привет', 'skilllink_bot')).toEqual({ kind: 'help' })
    expect(parseCommand('', 'skilllink_bot')).toEqual({ kind: 'help' })
    expect(parseCommand(undefined, 'skilllink_bot')).toEqual({ kind: 'help' })
  })
})

describe('обновление Telegram', () => {
  it('лишние поля отбрасываются: о человеке остаётся только ник', () => {
    const parsed = telegramUpdateSchema.parse({
      update_id: 1,
      message: {
        message_id: 5,
        chat: { id: 42, type: 'private', first_name: 'Иван', last_name: 'Иванов' },
        from: { id: 42, username: 'ivan', first_name: 'Иван', phone_number: '+70000000000' },
        text: '/today',
      },
    })
    expect(parsed).toEqual({
      update_id: 1,
      message: { chat: { id: 42, type: 'private' }, from: { username: 'ivan' }, text: '/today' },
    })
  })

  it('обновление без сообщения — тоже обновление, просто пропускается', () => {
    expect(telegramUpdateSchema.safeParse({ update_id: 2, edited_message: {} }).success).toBe(true)
    expect(telegramUpdateSchema.safeParse({ message: {} }).success).toBe(false)
  })
})

// ─────────────────────────────── Сводка ─────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000
const at = new Date(now)
const BASE = 'https://skilllink.example'

function stage(overrides: Partial<DigestStageSource>): DigestStageSource {
  return {
    stageId: 's-1',
    stageNumber: 6,
    stageTitle: 'Подписание документов',
    status: 'IN_PROGRESS',
    deadline: new Date(now - 5 * DAY),
    cooperationId: 'c-1',
    universityName: 'СПбГУТ',
    programName: 'Программная инженерия',
    siblings: [],
    ...overrides,
  }
}

function recommendation(overrides: Partial<DigestRecommendationSource>): DigestRecommendationSource {
  return {
    id: 'r-1',
    ruleKey: 'cooperation.idle',
    stageNumber: null,
    title: 'Связка без движения 30 дн.',
    label: 'МТУСИ — Анализ данных',
    priority: 'HIGH',
    cooperationId: 'c-2',
    ...overrides,
  }
}

function digest(sources: Partial<DigestSources>, baseUrl: string | null = BASE) {
  return buildDigest({ stages: [], recommendations: [], ...sources }, { now: at, baseUrl })
}

describe('сводка «что горит у меня»', () => {
  it('ничего не горит — короткая фраза и пометка «пусто»', () => {
    const result = digest({})
    expect(result.isEmpty).toBe(true)
    expect(result.text).toContain('ничего не горит')
  })

  it('каждый этап — ровно в одном разделе: просрочен, заблокирован, скоро срок', () => {
    const result = digest({
      stages: [
        stage({ stageId: 'late', deadline: new Date(now - 3 * DAY) }),
        stage({ stageId: 'late-blocked', status: 'BLOCKED', deadline: new Date(now - DAY) }),
        stage({ stageId: 'blocked', status: 'BLOCKED', deadline: null, stageNumber: 3, stageTitle: 'Встреча' }),
        stage({ stageId: 'soon', deadline: new Date(now + 2 * DAY), stageNumber: 7, stageTitle: 'Материалы' }),
        stage({ stageId: 'far', deadline: new Date(now + 30 * DAY) }),
      ],
    })
    expect(result.counts).toEqual({ overdue: 2, blocked: 1, dueSoon: 1, recommendations: 0 })
    expect(result.text).toContain('Просрочено — 2')
    expect(result.text).toContain('Заблокировано — 1')
    expect(result.text).toContain('Скоро срок — 1')
    expect(result.text).toContain('просрочка 3 дня')
    expect(result.text).toContain('этап заблокирован')
    expect(result.text).toContain('Срок 27.09.2026')
  })

  it('этап за незавершённой контрольной точкой не торопят', () => {
    const locked = stage({
      stageId: 'locked',
      stageNumber: 7,
      status: 'NOT_STARTED',
      deadline: new Date(now + DAY),
      siblings: [{ stageNumber: 6, title: 'Подписание документов', status: 'IN_PROGRESS' }],
    })
    expect(digest({ stages: [locked] }).isEmpty).toBe(true)
  })

  it('не начатый этап с прошедшим сроком — не просрочка (план сдвинут)', () => {
    expect(digest({ stages: [stage({ status: 'NOT_STARTED', deadline: new Date(now - DAY) })] }).isEmpty).toBe(true)
  })

  it('рекомендация о просрочке уже показанного этапа второй раз не идёт', () => {
    const result = digest({
      stages: [stage({ stageNumber: 6, cooperationId: 'c-1' })],
      recommendations: [
        recommendation({ id: 'dup', ruleKey: 'stage.overdue', stageNumber: 6, cooperationId: 'c-1', title: 'Просрочен этап 6' }),
        recommendation({ id: 'other', ruleKey: 'stage.overdue', stageNumber: 3, cooperationId: 'c-1', title: 'Просрочен этап 3' }),
      ],
    })
    expect(result.counts.recommendations).toBe(1)
    expect(result.text).not.toContain('recommendation=dup')
    expect(result.text).toContain('recommendation=other')
  })

  it('рекомендации — по важности, с подписью приоритета и объектом', () => {
    const result = digest({
      recommendations: [
        recommendation({ id: 'low', priority: 'LOW', title: 'Низкая' }),
        recommendation({ id: 'crit', priority: 'CRITICAL', title: 'Критичная' }),
      ],
    })
    expect(result.text.indexOf('Критичная')).toBeLessThan(result.text.indexOf('Низкая'))
    expect(result.text).toContain('• [Критичный] Критичная — МТУСИ — Анализ данных')
  })

  it('ссылки ведут на этап в карточке связки и на рекомендацию стенда', () => {
    const result = digest({
      stages: [stage({ stageId: 's-9', cooperationId: 'c-9' })],
      recommendations: [recommendation({ id: 'r-9' })],
    })
    expect(result.text).toContain(`${BASE}/cooperations/c-9?stage=s-9`)
    expect(result.text).toContain(`${BASE}/recommendations?recommendation=r-9`)
    expect(result.text).toContain(`Открыть SkillLink: ${BASE}/`)
  })

  it('без адреса стенда — текст без ссылок, но со всеми пунктами', () => {
    const result = digest({ stages: [stage({})] }, null)
    expect(result.text).not.toContain('http')
    expect(result.counts.overdue).toBe(1)
  })

  it('раздел не длиннее предела, остальное — «и ещё N»', () => {
    const many = Array.from({ length: TELEGRAM_DIGEST.perSection + 3 }, (_, index) =>
      stage({ stageId: `s-${index}`, deadline: new Date(now - (index + 1) * DAY) }),
    )
    const result = digest({ stages: many })
    expect(result.counts.overdue).toBe(TELEGRAM_DIGEST.perSection + 3)
    expect(result.text).toContain('…и ещё 3 — в системе')
    expect(result.text.split('\n').filter((line) => line.startsWith('• '))).toHaveLength(TELEGRAM_DIGEST.perSection)
  })

  it('в тексте нет почт и телефонов — только названия и сроки', () => {
    const result = digest({ stages: [stage({})], recommendations: [recommendation({})] })
    expect(result.text).not.toMatch(/@|\+7|\d{3}-\d{2}-\d{2}/)
  })
})
