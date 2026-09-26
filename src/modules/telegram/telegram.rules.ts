import { TELEGRAM_DIGEST, TELEGRAM_LINK } from '@/shared/config/telegram.config'
import { countWithNoun } from '@/shared/utils/text'
import { ROUTES } from '@/ui/lib/links'
import { formatDay } from '@/modules/ai-assist/ai-assist.rules'
import {
  buildPulse,
  calmText,
  PULSE_GROUPS,
  PULSE_SECTIONS,
  type DigestSources,
  type PulseItem,
  type PulseKind,
} from '@/modules/analytics/pulse.rules'

/**
 * Правила бота личных уведомлений (решение 102): разбор команд и текст сводки.
 *
 * Новых правил о том, ЧТО горит, здесь нет: что куда идёт, решает пульс
 * (`analytics/pulse.rules.ts`, решение 120) — тот же, что на странице «Пульс».
 * Этот файл только пишет его короткий текст для Telegram.
 *
 * В текст попадают только названия вузов, программ, этапов, рекомендаций и сроки.
 * Ни ФИО, ни почт, ни телефонов, ни причин блокировки (в них пишут что угодно,
 * в том числе имена): Telegram — иностранный сервис (docs/PRIVACY.md).
 */

// ─────────────────────────────── Команды ────────────────────────────────────

export type BotCommand =
  | { kind: 'start'; token: string | null }
  | { kind: 'today' }
  | { kind: 'stop' }
  | { kind: 'help' }

const COMMAND_PATTERN = /^\/([a-z_]+)(?:@([a-z0-9_]+))?(?:\s+([\s\S]*))?$/i

/**
 * Команда из текста сообщения. `/start@ИмяБота токен` — так Telegram пишет
 * команду, адресованную конкретному боту; команда другому боту — не нам,
 * и на неё тоже справка. Всё непонятное — справка.
 */
export function parseCommand(text: string | null | undefined, botUsername: string | null): BotCommand {
  const match = COMMAND_PATTERN.exec((text ?? '').trim())
  if (!match) return { kind: 'help' }
  const [, name, addressee, rest] = match
  if (addressee && botUsername && addressee.toLowerCase() !== botUsername.toLowerCase()) return { kind: 'help' }

  switch (name!.toLowerCase()) {
    case 'start': {
      const token = (rest ?? '').trim()
      return { kind: 'start', token: token === '' ? null : token }
    }
    case 'today':
      return { kind: 'today' }
    case 'stop':
      return { kind: 'stop' }
    default:
      return { kind: 'help' }
  }
}

// ─────────────────────────────── Ответы бота ────────────────────────────────

const LINK_MINUTES = Math.round(TELEGRAM_LINK.ttlMs / 60_000)

export const BOT_REPLIES = {
  help: [
    'Бот SkillLink присылает сводку «что горит у меня»: просроченные и заблокированные этапы, ' +
      'близкие сроки и открытые рекомендации по вашим связкам.',
    '',
    '/today — сводка сейчас',
    '/stop — отключить уведомления',
    '',
    'Подключить — в SkillLink: «Личный кабинет» → «Уведомления в Telegram» → «Подключить».',
  ].join('\n'),
  startWithoutToken:
    'Чтобы подключить уведомления, откройте SkillLink: «Личный кабинет» → «Уведомления в Telegram» → ' +
    '«Подключить». Ссылка оттуда привяжет этот чат к вашей учётной записи.',
  invalidToken:
    `Ссылка для подключения недействительна или устарела: она живёт ${LINK_MINUTES} минут и срабатывает ` +
    'один раз. Откройте личный кабинет SkillLink и нажмите «Подключить» ещё раз.',
  chatTakenByOther:
    'Этот чат уже привязан к другому сотруднику. Отключите его там командой /stop или попросите администратора.',
  linked:
    'Готово: уведомления SkillLink подключены к этому чату. Сводку можно получить командой /today. ' +
    'Отключить — /stop или в личном кабинете.',
  notLinked:
    'Этот чат не подключён к SkillLink. Подключить — в личном кабинете: «Уведомления в Telegram» → «Подключить».',
  stopped: 'Уведомления отключены: этот чат больше не привязан к SkillLink.',
  notPrivate:
    'Бот работает только в личной переписке: сводка — о ваших делах, в общий чат она не отправляется.',
  unavailable: 'Сводка сейчас недоступна. Попробуйте позже или откройте SkillLink.',
} as const

// ─────────────────────────────── Сводка ─────────────────────────────────────

/** Источники сводки — те же, что у пульса (решение 120). */
export type {
  DigestRecommendationSource,
  DigestSources,
  DigestStageSource,
  PulseExtras,
} from '@/modules/analytics/pulse.rules'

export interface Digest {
  text: string
  /** Ничего не горит и нечем порадовать: рассылка по расписанию такое не отправляет. */
  isEmpty: boolean
  counts: { overdue: number; blocked: number; dueSoon: number; recommendations: number }
}

/** Ссылка на страницу стенда; без базового адреса ссылок нет вовсе. */
function absolute(baseUrl: string | null, path: string | null): string | null {
  if (!path) return null
  return baseUrl ? `${baseUrl.replace(/\/+$/, '')}${path}` : null
}

function group(title: string, items: readonly PulseItem[], baseUrl: string | null): string[] {
  if (items.length === 0) return []
  const shown = items.slice(0, TELEGRAM_DIGEST.perSection)
  const rest = items.length - shown.length
  return [
    `${title} — ${items.length}`,
    ...shown.flatMap((entry) => {
      const link = absolute(baseUrl, entry.href)
      return link ? [`• ${entry.text}`, `  ${link}`] : [`• ${entry.text}`]
    }),
    ...(rest > 0 ? [`…и ещё ${rest} — в системе`] : []),
  ]
}

/**
 * Сводка «что горит у меня» — текст пульса для Telegram.
 *
 * Разделы «Внимание», «Сегодня», «Решить», «Успехи»; внутри — группы с потолком
 * `TELEGRAM_DIGEST.perSection` пунктов («…и ещё N — в системе»). Пустой пульс —
 * «всё спокойно» со счётчиком проверенных правил; только успехи — сводка уходит
 * (хорошая новость — тоже новость), совсем пустая — нет.
 */
export function buildDigest(
  sources: DigestSources,
  options: { now: Date; baseUrl: string | null },
): Digest {
  const { now, baseUrl } = options
  const pulse = buildPulse(sources, now)
  const counts = {
    overdue: pulse.counts['stage.overdue'],
    blocked: pulse.counts['stage.blocked'],
    dueSoon: pulse.counts['stage.due-soon'],
    recommendations: pulse.counts['recommendation.stale'] + pulse.counts['recommendation.open'],
  }
  const today = formatDay(now.toISOString())
  const home = absolute(baseUrl, ROUTES.dashboard)

  if (pulse.items.length === 0) {
    return { text: `SkillLink · ${today}. ${calmText(pulse.checkedRules)}`, isEmpty: true, counts }
  }

  const kinds = Object.keys(PULSE_GROUPS) as PulseKind[]
  const lines = [
    `SkillLink · что горит на ${today} · проверено ` +
      countWithNoun(pulse.checkedRules, ['правило', 'правила', 'правил']),
  ]
  if (pulse.isCalm) lines.push('', 'Внимания ничего не требует.')
  for (const section of PULSE_SECTIONS) {
    const body = kinds
      .filter((kind) => PULSE_GROUPS[kind].section === section.key)
      .flatMap((kind) => group(PULSE_GROUPS[kind].title, pulse.items.filter((entry) => entry.kind === kind), baseUrl))
    if (body.length > 0) lines.push('', section.title.toUpperCase(), ...body)
  }
  if (home) lines.push('', `Открыть SkillLink: ${home}`)

  return { text: lines.join('\n'), isEmpty: false, counts }
}
