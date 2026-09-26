import { OWNER_ALERT } from '@/shared/config/ops.config'
import { anyChannelConfigured, dispatchToRecipientKey, ownerRecipientKeys } from '@/modules/notify-channels/notify-channels.service'

/**
 * Оповещения владельцу о событиях безопасности — через каналы уведомлений
 * (решение 118, решение 144: Telegram, MAX, VK).
 *
 *     notifyOwner('user.blocked', { key: userId, details: { userId, by: actor.id } })
 *
 * «Отправил и забыл»: функция возвращает управление сразу, ничего не ждёт и никогда
 * не бросает — сбой оповещения не должен ломать вход, блокировку или выгрузку.
 * Отправка ограничена по времени (AbortController, OWNER_ALERT.timeoutMs).
 *
 * - **Кому:** активные администраторы с привязанным каналом (Telegram — telegram_links,
 *   решение 102; MAX/VK — notification_channel_links, решение 144: основной канал
 *   администратора, иначе первый привязанный) и чат TELEGRAM_OWNER_CHAT_ID, если
 *   задан. Ни один канал не настроен — строка в журнале «каналы не настроены»
 *   и ничего больше (`getChannels`/`notify-channels.service.ts` решают, что «настроено»,
 *   этот модуль — только доставка).
 * - **Без повторов:** одно и то же событие с тем же `key` — не чаще раза в 15 минут
 *   (память процесса). Перебор пароля даёт одно сообщение, а не сотню.
 * - **Без персональных данных:** MAX, VK и Telegram — внешние сервисы (Telegram —
 *   зарубежный, MAX и VK — российские, подробности в docs/PRIVACY.md). Почта и логин
 *   маскируются (`i***@m***.ru`), адрес клиента — до сети (`203.0.*.*`); любая строка,
 *   похожая на почту, маскируется, даже если пришла под другим именем поля.
 *   Идентификаторы записей (cuid) — не персональные данные сами по себе, по ним
 *   владелец находит запись в журнале действий.
 *
 * Другие части системы (запросы субъектов ПД, ограничение частоты запросов) вызывают
 * ту же функцию: добавляют своё событие в `OWNER_ALERT_EVENTS` и зовут `notifyOwner`.
 */

export type OwnerAlertSeverity = 'info' | 'warning' | 'critical'

/** Каталог событий: заголовок и важность по умолчанию. Новое событие — строка здесь. */
export const OWNER_ALERT_EVENTS = {
  'login.blocked': { title: 'Вход закрыт после неудачных попыток', severity: 'warning' },
  'login.captcha-burst': { title: 'Массово включается проверка «не робот» на входе', severity: 'warning' },
  'admin.login.new-address': { title: 'Вход администратора с нового адреса', severity: 'info' },
  'user.blocked': { title: 'Пользователь заблокирован', severity: 'info' },
  'user.role.admin': { title: 'Выдана роль администратора', severity: 'warning' },
  'export.bulk': { title: 'Массовая выгрузка данных', severity: 'warning' },
} as const satisfies Record<string, { title: string; severity: OwnerAlertSeverity }>

export type OwnerAlertEvent = keyof typeof OWNER_ALERT_EVENTS

type DetailValue = string | number | boolean | null | undefined | readonly string[]

export interface OwnerAlertPayload {
  /** Ключ защиты от повторов: чья учётная запись, чей адрес. Без него — само событие. */
  key?: string
  severity?: OwnerAlertSeverity
  /** Служебные поля. Почта и адрес маскируются по имени поля и по виду значения. */
  details?: Record<string, DetailValue>
}

// ── Маскирование ─────────────────────────────────────────────────────────────

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g

/** `ivan.petrov@mail.ru` → `i***@m***.ru`: видно, что за домен, не видно кто. */
export function maskEmail(value: string): string {
  const at = value.lastIndexOf('@')
  if (at <= 0) return value.length <= 1 ? '***' : `${value[0]}***`
  const local = value.slice(0, at)
  const domain = value.slice(at + 1)
  const dot = domain.lastIndexOf('.')
  const zone = dot > 0 ? domain.slice(dot) : ''
  return `${local[0]}***@${domain[0] ?? ''}***${zone}`
}

/** Адрес клиента до сети: `203.0.113.5` → `203.0.*.*`, IPv6 — первые два блока. */
export function maskAddress(value: string): string {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return value.split('.').slice(0, 2).join('.') + '.*.*'
  if (value.includes(':')) return value.split(':').slice(0, 2).join(':') + ':*'
  return value === 'unknown' ? value : '***'
}

const EMAIL_FIELDS = new Set(['account', 'email'])
const ADDRESS_FIELDS = new Set(['address', 'ip'])

const LABELS: Record<string, string> = {
  account: 'учётная запись',
  email: 'почта',
  address: 'адрес',
  ip: 'адрес',
  counters: 'счётчики',
  userId: 'пользователь (id)',
  by: 'кем (id)',
  from: 'прежняя роль',
  to: 'новая роль',
  dataset: 'набор',
  rows: 'строк',
  count: 'сколько раз',
  windowMinutes: 'за минут',
}

function maskValue(field: string, value: string): string {
  if (EMAIL_FIELDS.has(field)) return maskEmail(value)
  if (ADDRESS_FIELDS.has(field)) return maskAddress(value)
  return value.replace(EMAIL, (match) => maskEmail(match)).slice(0, 200)
}

const SEVERITY_MARK: Record<OwnerAlertSeverity, string> = { info: '🔵', warning: '🟠', critical: '🔴' }

/** Текст сообщения. Чистая функция: по ней проверяется, что ПД в Telegram не уходят. */
export function formatOwnerAlert(event: OwnerAlertEvent, payload: OwnerAlertPayload, now: Date): string {
  const spec = OWNER_ALERT_EVENTS[event]
  const severity = payload.severity ?? spec.severity
  const lines = [`${SEVERITY_MARK[severity]} SkillLink · ${spec.title}`]
  for (const [field, raw] of Object.entries(payload.details ?? {})) {
    if (raw === undefined || raw === null) continue
    const value = Array.isArray(raw) ? raw.join(', ') : String(raw)
    lines.push(`${LABELS[field] ?? field}: ${maskValue(field, value)}`)
  }
  const moscow = now.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' })
  lines.push(`${moscow} МСК · событие ${event}`)
  return lines.join('\n')
}

// ── Отправка ─────────────────────────────────────────────────────────────────

export interface OwnerNotifierDeps {
  /** Настроен ли бот. */
  enabled: () => boolean
  recipients: () => Promise<string[]>
  send: (chatId: string, text: string) => Promise<{ ok: boolean }>
  now?: () => number
  timeoutMs?: number
  dedupeMs?: number
  log?: (line: string) => void
}

export interface OwnerNotifier {
  notify: (event: OwnerAlertEvent, payload?: OwnerAlertPayload) => void
  /** Только для тестов: дождаться отправок, начатых к этому моменту. */
  settled: () => Promise<void>
  /** Только для тестов: забыть отправленное. */
  reset: () => void
}

class TimeoutError extends Error {}

/** Промис, который отклоняется, когда сработал сигнал. */
function abortion(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new TimeoutError('таймаут')), { once: true })
  })
}

export function createOwnerNotifier(deps: OwnerNotifierDeps): OwnerNotifier {
  const now = deps.now ?? Date.now
  const timeoutMs = deps.timeoutMs ?? OWNER_ALERT.timeoutMs
  const dedupeMs = deps.dedupeMs ?? OWNER_ALERT.dedupeMs
  const log = deps.log ?? ((line: string) => console.info(line))
  const lastSent = new Map<string, number>()
  const pending = new Set<Promise<void>>()

  /** true — можно слать; запоминает отправку сразу, чтобы параллельный вызов не прошёл. */
  function admit(key: string, at: number): boolean {
    const previous = lastSent.get(key)
    if (previous !== undefined && at - previous < dedupeMs) return false
    lastSent.delete(key)
    if (lastSent.size >= OWNER_ALERT.maxRemembered) {
      // Сначала то, что уже ничего не подавляет; не хватило — самые старые
      // (порядок записей в Map — порядок вставки).
      for (const [stale, time] of lastSent) if (at - time >= dedupeMs) lastSent.delete(stale)
      for (const stale of lastSent.keys()) {
        if (lastSent.size < OWNER_ALERT.maxRemembered) break
        lastSent.delete(stale)
      }
    }
    lastSent.set(key, at)
    return true
  }

  async function deliver(event: OwnerAlertEvent, text: string): Promise<void> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const work = (async () => {
        const chats = [...new Set(await deps.recipients())]
        if (chats.length === 0) return { sent: 0, total: 0 }
        const results = await Promise.all(chats.map((chat) => deps.send(chat, text).catch(() => ({ ok: false }))))
        return { sent: results.filter((result) => result.ok).length, total: chats.length }
      })()
      const { sent, total } = await Promise.race([work, abortion(controller.signal)])
      log(
        total === 0
          ? `[owner-alert] ${event}: получателей нет — нет ни администратора с привязанным ботом, ни TELEGRAM_OWNER_CHAT_ID`
          : `[owner-alert] ${event}: отправлено ${sent} из ${total}`,
      )
    } catch (error) {
      log(`[owner-alert] ${event}: не отправлено — ${error instanceof TimeoutError ? `дольше ${timeoutMs} мс` : 'сбой'}`)
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    notify(event, payload = {}) {
      try {
        if (!(event in OWNER_ALERT_EVENTS)) return
        const at = now()
        if (!admit(`${event}\n${payload.key ?? ''}`, at)) return
        if (!deps.enabled()) {
          log(`[owner-alert] ${event}: ни один канал не настроен (Telegram/MAX/VK) — не отправлено`)
          return
        }
        const text = formatOwnerAlert(event, payload, new Date(at))
        const task = deliver(event, text).catch(() => undefined)
        pending.add(task)
        void task.finally(() => pending.delete(task))
      } catch {
        // Оповещение не имеет права ломать то, о чём оповещает.
      }
    },
    async settled() {
      await Promise.all([...pending])
    },
    reset() {
      lastSent.clear()
    },
  }
}

// ── Экземпляр приложения ─────────────────────────────────────────────────────

/**
 * Получатели и доставка — через общий слой каналов (решение 144): каждый ключ
 * из `ownerRecipientKeys()` — `<канал>:<чат>` (администратор с основным или первым
 * привязанным каналом, плюс TELEGRAM_OWNER_CHAT_ID из настроек), `dispatchToRecipientKey`
 * разбирает ключ и шлёт через нужный адаптер. Раньше здесь читался только
 * `telegramLink` напрямую — поведение для Telegram не изменилось, каналы добавлены рядом.
 */
const defaultNotifier = createOwnerNotifier({
  enabled: anyChannelConfigured,
  recipients: ownerRecipientKeys,
  send: dispatchToRecipientKey,
})

/** Отправить владельцу и забыть. Никогда не бросает и не ждёт. */
export function notifyOwner(event: OwnerAlertEvent, payload?: OwnerAlertPayload): void {
  defaultNotifier.notify(event, payload)
}

// ── Всплески ─────────────────────────────────────────────────────────────────

/**
 * Счётчик событий в скользящем окне: «массовое» — это когда за окно набралось
 * порога. Ключей не больше тысячи: при переполнении забываются самые старые.
 */
export class BurstCounter {
  private readonly hits = new Map<string, number[]>()

  constructor(private readonly windowMs: number) {}

  /** Отмечает событие и возвращает, сколько их по ключу за окно. */
  hit(key: string, at: number): number {
    const recent = (this.hits.get(key) ?? []).filter((time) => at - time < this.windowMs)
    recent.push(at)
    this.hits.delete(key)
    if (this.hits.size >= OWNER_ALERT.maxRemembered) {
      const oldest = this.hits.keys().next().value
      if (oldest !== undefined) this.hits.delete(oldest)
    }
    // Больше порога хранить незачем, но предел держим с запасом.
    this.hits.set(key, recent.slice(-1000))
    return recent.length
  }

  reset(): void {
    this.hits.clear()
  }
}
