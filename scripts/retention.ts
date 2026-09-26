/**
 * Сроки хранения журнала действий — docs/PRIVACY.md, раздел «Сроки хранения».
 *
 *   npm run db:retention                 показать, что будет сделано (ничего не меняет)
 *   npm run db:retention -- --dry-run    то же самое, явно
 *   npm run db:retention -- --apply      сделать
 *
 * Что делает:
 *   1. удаляет записи журнала действий старше RETENTION.auditLogDays (365 дней);
 *   2. в записях старше RETENTION.clientAddressDays (90 дней) стирает адрес
 *      клиента (IP) — сама запись о действии остаётся до п. 1.
 *
 * Журнал защищён цепочкой хешей (решение 115), и обе операции её не ломают:
 *   - адрес клиента в хеш строки не входит — стирание идёт обычным UPDATE с обходом
 *     запрета (`skilllink.allow_audit_purge`) в той же транзакции;
 *   - удаляется только НАЧАЛО цепочки — функцией audit_purge_before(), которая
 *     записывает точку чистки. Запись старше срока, стоящая в цепочке после более
 *     свежей (долгая транзакция), удалится при следующем запуске.
 *
 * Сроки — src/shared/config/retention.config.ts, правила отбора —
 * src/modules/audit/retention.rules.ts (с тестом).
 *
 * На стенде запускается ролью-владельцем базы через сервис migrate: у роли
 * приложения права удалять журнал нет (create-app-role.sql, решение 89).
 * Расписание — cron владельца сервера, docs/DEPLOY.md; пока не включено.
 *
 * Факт применения пишется в сам журнал (`audit.retention`) — только числа.
 *
 * Попутно (решение 133) — служебные таблицы без ПД: отметки обработанных
 * обновлений Telegram старше 7 суток, ключи идемпотентности старше 24 часов,
 * просроченные запросы на одобрение (статус EXPIRED). Приложение чистит их
 * и само, при работе; здесь — для стенда, где запросов давно не было.
 */

import 'dotenv/config'
import { PrismaClient } from '@/generated/prisma/client'
import type { Prisma } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { RETENTION } from '@/shared/config/retention.config'
import { TELEGRAM_WEBHOOK } from '@/shared/config/telegram.config'
import { IDEMPOTENCY } from '@/shared/config/idempotency.config'
import { writeAudit } from '@/shared/audit/audit'
import {
  planRetention,
  retentionCutoffs,
  stripClientAddress,
  type RetentionCutoffs,
} from '@/modules/audit/retention.rules'

function parseMode(argv: readonly string[]): 'apply' | 'dry-run' {
  const apply = argv.includes('--apply')
  if (apply && argv.includes('--dry-run')) {
    console.error('Укажите что-то одно: --apply или --dry-run')
    process.exit(2)
  }
  const unknown = argv.filter((arg) => arg.startsWith('--') && arg !== '--apply' && arg !== '--dry-run')
  if (unknown.length > 0) {
    console.error(`Неизвестные параметры: ${unknown.join(' ')}. Есть только --dry-run и --apply.`)
    process.exit(2)
  }
  return apply ? 'apply' : 'dry-run'
}

const day = (date: Date) => date.toISOString().slice(0, 10)

/** Записи к удалению по видам действий — чтобы было видно, что уходит. */
async function describeDeletion(prisma: PrismaClient, cutoffs: RetentionCutoffs): Promise<PurgeResult> {
  const groups = await prisma.auditLog.groupBy({
    by: ['action'],
    where: { createdAt: { lt: cutoffs.deleteBefore } },
    _count: { _all: true },
    orderBy: { action: 'asc' },
  })
  const total = groups.reduce((sum, group) => sum + group._count._all, 0)
  console.log(`Записей журнала старше ${day(cutoffs.deleteBefore)}: ${total}`)
  for (const group of groups) console.log(`   ${group.action}: ${group._count._all}`)
  const plan = await purge(prisma, cutoffs, false)
  console.log(`Удалится начало цепочки: ${plan.deleted} (по № ${plan.cutSeq ?? '—'})`)
  if (plan.olderKept > 0n) {
    console.log(`   старше срока, но после более свежей записи — останутся до следующего запуска: ${plan.olderKept}`)
  }
  return plan
}

interface PurgeResult {
  cutSeq: bigint | null
  deleted: bigint
  olderKept: bigint
}

/** audit_purge_before(): без `apply` только считает. Граница — UTC без часового пояса, как в колонке. */
async function purge(prisma: PrismaClient, cutoffs: RetentionCutoffs, apply: boolean): Promise<PurgeResult> {
  const cutoff = cutoffs.deleteBefore.toISOString()
  const [row] = await prisma.$queryRaw<Array<{ cut_seq: bigint | null; deleted: bigint; older_kept: bigint }>>`
    SELECT * FROM audit_purge_before(${cutoff}::timestamp, ${apply})`
  return { cutSeq: row?.cut_seq ?? null, deleted: row?.deleted ?? 0n, olderKept: row?.older_kept ?? 0n }
}

/**
 * Стирает адрес клиента пачками. При показе в пачку попадают только записи между
 * границами: более старые будут удалены целиком. При применении стирание идёт после
 * чистки и берёт всё старше срока адреса: чистка удаляет только начало цепочки,
 * и запись старше срока журнала, оставшаяся до следующего запуска, адрес тоже теряет.
 */
async function stripAddresses(
  prisma: PrismaClient,
  cutoffs: RetentionCutoffs,
  apply: boolean,
): Promise<number> {
  const scope = apply ? { ...cutoffs, deleteBefore: new Date(0) } : cutoffs
  let cursor: string | undefined
  let stripped = 0

  for (;;) {
    const rows = await prisma.auditLog.findMany({
      where: { createdAt: { gte: scope.deleteBefore, lt: scope.stripAddressBefore } },
      select: { id: true, createdAt: true, payload: true },
      orderBy: { id: 'asc' },
      take: RETENTION.batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
    if (rows.length === 0) break
    cursor = rows.at(-1)!.id

    const { stripIds } = planRetention(rows, scope)
    if (apply && stripIds.length > 0) {
      const byId = new Map(rows.map((row) => [row.id, row]))
      // Запрет правки журнала обходится только в этой транзакции (решение 115).
      await prisma.$transaction([
        prisma.$executeRaw`SELECT set_config('skilllink.allow_audit_purge', 'on', true)`,
        ...stripIds.map((id) =>
          prisma.auditLog.update({
            where: { id },
            data: {
              payload: stripClientAddress(byId.get(id)!.payload as Record<string, unknown>) as Prisma.InputJsonValue,
            },
          }),
        ),
      ])
    }
    stripped += stripIds.length
  }

  return stripped
}

/** Служебные таблицы решения 133: только числа, без ПД. */
async function cleanServiceTables(prisma: PrismaClient, apply: boolean): Promise<void> {
  const now = Date.now()
  const seenBefore = new Date(now - TELEGRAM_WEBHOOK.seenRetentionDays * 86_400_000)
  const keysBefore = new Date(now - IDEMPOTENCY.ttlMs)
  const expiring = { status: { in: ['REQUESTED', 'APPROVED'] as const }, expiresAt: { lte: new Date(now) } }
  if (!apply) {
    const [seen, keys, approvals] = await Promise.all([
      prisma.telegramUpdateSeen.count({ where: { seenAt: { lt: seenBefore } } }),
      prisma.idempotencyKey.count({ where: { createdAt: { lt: keysBefore } } }),
      prisma.approval.count({ where: { status: { in: ['REQUESTED', 'APPROVED'] }, expiresAt: { lte: new Date(now) } } }),
    ])
    console.log(`Служебные таблицы: отметок Telegram к удалению ${seen}, ключей идемпотентности ${keys}, одобрений истекло ${approvals}`)
    return
  }
  const seen = await prisma.telegramUpdateSeen.deleteMany({ where: { seenAt: { lt: seenBefore } } })
  const keys = await prisma.idempotencyKey.deleteMany({ where: { createdAt: { lt: keysBefore } } })
  const approvals = await prisma.approval.updateMany({
    where: { status: { in: [...expiring.status.in] }, expiresAt: expiring.expiresAt },
    data: { status: 'EXPIRED' },
  })
  console.log(`Служебные таблицы: удалено отметок Telegram ${seen.count}, ключей идемпотентности ${keys.count}; одобрений истекло ${approvals.count}`)
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2))
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('Не задан DATABASE_URL')
    process.exit(1)
  }

  const cutoffs = retentionCutoffs(new Date(), RETENTION)
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })

  try {
    console.log(
      mode === 'apply'
        ? '── Сроки хранения журнала: применяю'
        : '── Сроки хранения журнала: только показ (для применения — --apply)',
    )
    console.log(
      `   журнал — ${RETENTION.auditLogDays} дн., адрес клиента — ${RETENTION.clientAddressDays} дн.`,
    )

    const plan = await describeDeletion(prisma, cutoffs)
    await cleanServiceTables(prisma, mode === 'apply')

    if (mode === 'dry-run') {
      const toStrip = await stripAddresses(prisma, cutoffs, false)
      console.log(`Стереть адрес клиента в записях старше ${day(cutoffs.stripAddressBefore)}: ${toStrip}`)
      console.log('Ничего не изменено.')
      return
    }

    const done = await purge(prisma, cutoffs, true)
    const stripped = await stripAddresses(prisma, cutoffs, true)
    console.log(
      `Удалено записей: ${done.deleted} (ожидалось ${plan.deleted})` +
        (done.cutSeq === null ? '. ' : `, цепочка журнала теперь начинается с № ${done.cutSeq + 1n}. `) +
        `Адрес стёрт в записях: ${stripped}.`,
    )

    // Факт применения — в сам журнал, только числа и границы.
    await writeAudit(
      {
        userId: null,
        action: 'audit.retention',
        objectType: 'AuditLog',
        objectId: 'retention',
        payload: {
          deleted: Number(done.deleted),
          olderKept: Number(done.olderKept),
          ...(done.cutSeq === null ? {} : { cutSeq: Number(done.cutSeq) }),
          addressesStripped: stripped,
          deleteBefore: cutoffs.deleteBefore.toISOString(),
          stripAddressBefore: cutoffs.stripAddressBefore.toISOString(),
        },
      },
      prisma,
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error('Сроки хранения не применены:', error instanceof Error ? error.message : error)
  process.exit(1)
})
