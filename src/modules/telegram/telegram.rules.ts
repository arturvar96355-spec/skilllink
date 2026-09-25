import { TELEGRAM_DIGEST, TELEGRAM_LINK } from '@/shared/config/telegram.config'
import { RECOMMENDATION_PRIORITY_LABELS } from '@/shared/contracts/labels'
import type { RecommendationPriority, StageStatus } from '@/shared/contracts/enums'
import { daysBetween } from '@/shared/utils/date'
import { countWithNoun } from '@/shared/utils/text'
import { cooperationHref, recommendationHref, ROUTES } from '@/ui/lib/links'
import { formatDay } from '@/modules/ai-assist/ai-assist.rules'
import { isDueSoon, isLockedByControlPoint, isOverdue } from '@/modules/workflow/workflow.rules'

/**
 * Правила бота личных уведомлений (решение 102): разбор команд и текст сводки.
 *
 * Новых правил о том, ЧТО горит, здесь нет: просрочка, «скоро срок» и запертый
 * контрольной точкой этап — правила этапов (`workflow.rules`), склейка просрочки
 * с рекомендацией о ней — как в ленте уведомлений. Этот файл только раскладывает
 * посчитанное по разделам и пишет короткий текст.
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

/** Незакрытый этап связки пользователя: просроченный, заблокированный или со сроком скоро. */
export interface DigestStageSource {
  stageId: string
  stageNumber: number
  stageTitle: string
  status: StageStatus
  deadline: Date | null
  cooperationId: string
  universityName: string
  programName: string
  /** Все этапы связки: по ним видно, не заперт ли этап контрольной точкой. */
  siblings: ReadonlyArray<{ stageNumber: number; title: string; status: StageStatus }>
}

/** Открытая рекомендация по связке пользователя — только названия, без текста правила. */
export interface DigestRecommendationSource {
  id: string
  ruleKey: string
  /** Номер этапа из данных правила (у просрочки он есть), иначе null. */
  stageNumber: number | null
  title: string
  /** Имя объекта: «СПбГУТ — Программная инженерия». */
  label: string
  priority: RecommendationPriority
  cooperationId: string | null
}

export interface DigestSources {
  stages: readonly DigestStageSource[]
  recommendations: readonly DigestRecommendationSource[]
}

export interface Digest {
  text: string
  /** Ничего не горит: рассылка по расписанию такое не отправляет. */
  isEmpty: boolean
  counts: { overdue: number; blocked: number; dueSoon: number; recommendations: number }
}

const PRIORITY_RANK: Record<RecommendationPriority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
const DAY_FORMS = ['день', 'дня', 'дней'] as const

/** Ссылка на страницу стенда; без базового адреса ссылок нет вовсе. */
function absolute(baseUrl: string | null, path: string): string | null {
  return baseUrl ? `${baseUrl.replace(/\/+$/, '')}${path}` : null
}

function stageLine(stage: DigestStageSource, tail: string): string {
  return `• Этап ${stage.stageNumber} «${stage.stageTitle}», ${stage.universityName} — ${stage.programName}${tail}`
}

function section(title: string, lines: ReadonlyArray<{ text: string; link: string | null }>): string[] {
  if (lines.length === 0) return []
  const shown = lines.slice(0, TELEGRAM_DIGEST.perSection)
  const rest = lines.length - shown.length
  return [
    '',
    `${title} — ${lines.length}`,
    ...shown.flatMap((line) => (line.link ? [line.text, `  ${line.link}`] : [line.text])),
    ...(rest > 0 ? [`…и ещё ${rest} — в системе`] : []),
  ]
}

/**
 * Сводка «что горит у меня» — чистая функция от источников.
 *
 * Этап попадает ровно в один раздел: просрочен (`isOverdue`, в том числе
 * заблокированный с вышедшим сроком) → заблокирован → скоро срок (`isDueSoon`).
 * Этап за незавершённой контрольной точкой не идёт никуда — торопить с
 * запрещённым незачем (как в ленте). Рекомендация о просрочке этапа, который
 * уже в разделе «Просрочено», второй раз не идёт.
 */
export function buildDigest(
  sources: DigestSources,
  options: { now: Date; baseUrl: string | null },
): Digest {
  const { now, baseUrl } = options
  const overdue: DigestStageSource[] = []
  const blocked: DigestStageSource[] = []
  const dueSoon: DigestStageSource[] = []

  for (const stage of sources.stages) {
    if (isLockedByControlPoint(stage, stage.siblings)) continue
    if (isOverdue(stage.deadline, stage.status, now)) overdue.push(stage)
    else if (stage.status === 'BLOCKED') blocked.push(stage)
    else if (isDueSoon(stage.deadline, stage.status, now)) dueSoon.push(stage)
  }
  const byDeadline = (a: DigestStageSource, b: DigestStageSource) =>
    (a.deadline?.getTime() ?? Infinity) - (b.deadline?.getTime() ?? Infinity) || a.stageId.localeCompare(b.stageId)
  overdue.sort(byDeadline)
  blocked.sort(byDeadline)
  dueSoon.sort(byDeadline)

  const overdueKeys = new Set(overdue.map((stage) => `${stage.cooperationId}#${stage.stageNumber}`))
  const recommendations = sources.recommendations
    .filter(
      (item) =>
        !(
          item.ruleKey === 'stage.overdue' &&
          item.cooperationId !== null &&
          item.stageNumber !== null &&
          overdueKeys.has(`${item.cooperationId}#${item.stageNumber}`)
        ),
    )
    // Порядок источника (важность, затем новые) сохраняется внутри одной важности.
    .map((item, index) => ({ item, index }))
    .sort((a, b) => PRIORITY_RANK[a.item.priority] - PRIORITY_RANK[b.item.priority] || a.index - b.index)
    .map(({ item }) => item)

  const stageLink = (stage: DigestStageSource) => absolute(baseUrl, cooperationHref(stage.cooperationId, stage.stageId))
  const counts = {
    overdue: overdue.length,
    blocked: blocked.length,
    dueSoon: dueSoon.length,
    recommendations: recommendations.length,
  }
  const today = formatDay(now.toISOString())
  const home = absolute(baseUrl, ROUTES.dashboard)

  if (overdue.length + blocked.length + dueSoon.length + recommendations.length === 0) {
    return {
      text:
        `SkillLink · ${today}: ничего не горит — просрочек, блокировок, близких сроков ` +
        'и открытых рекомендаций по вашим связкам нет.',
      isEmpty: true,
      counts,
    }
  }

  const lines = [
    `SkillLink · что горит на ${today}`,
    ...section(
      'Просрочено',
      overdue.map((stage) => {
        const late = stage.deadline ? daysBetween(stage.deadline, now) : 0
        const blockedMark = stage.status === 'BLOCKED' ? ', этап заблокирован' : ''
        return {
          text: stageLine(
            stage,
            `. Срок ${formatDay(stage.deadline?.toISOString() ?? null)}` +
              (late > 0 ? `, просрочка ${countWithNoun(late, DAY_FORMS)}` : '') +
              blockedMark,
          ),
          link: stageLink(stage),
        }
      }),
    ),
    ...section(
      'Заблокировано',
      blocked.map((stage) => ({
        text: stageLine(stage, stage.deadline ? `. Срок ${formatDay(stage.deadline.toISOString())}` : ''),
        link: stageLink(stage),
      })),
    ),
    ...section(
      'Скоро срок',
      dueSoon.map((stage) => ({
        text: stageLine(stage, `. Срок ${formatDay(stage.deadline?.toISOString() ?? null)}`),
        link: stageLink(stage),
      })),
    ),
    ...section(
      'Рекомендации',
      recommendations.map((item) => ({
        text:
          `• [${RECOMMENDATION_PRIORITY_LABELS[item.priority]}] ${item.title}` +
          (item.label && item.label !== item.title ? ` — ${item.label}` : ''),
        link: absolute(baseUrl, recommendationHref(item.id)),
      })),
    ),
    ...(home ? ['', `Открыть SkillLink: ${home}`] : []),
  ]

  return { text: lines.join('\n'), isEmpty: false, counts }
}
