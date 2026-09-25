/**
 * Цепочка хешей журнала действий (решение 115) — проверка и печать из командной строки.
 *
 *   npm run audit:verify                         проверить цепочку и печати; код 1 — нарушение
 *   npm run audit:verify -- --expect-seq N --expect-hash H
 *                                                и сверить с печатью, хранящейся вне базы
 *                                                (из сообщения владельцу)
 *   npm run audit:seal                           снять печать: сохранить в audit_seals и напечатать JSON
 *
 * Вывод — одна строка JSON на stdout (для cron и отправки владельцу), пояснение — на stderr.
 * Проверка пишет свой итог в журнал (`audit.verify`, source: "script"); `--no-audit` — не писать.
 *
 * На стенде — через сервис migrate: в рабочем образе приложения нет ни scripts/, ни tsx
 * (docs/DEPLOY.md, «Журнал действий: проверка и печати»).
 */

import { config } from 'dotenv'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { writeAudit } from '@/shared/audit/audit'
import { auditSeal, auditVerifyPayload, toVerifyDto, verifyChain } from '@/modules/audit/chain.service'
import { parseExternalSeal } from '@/modules/audit/chain.rules'

// Тихо: stdout — только JSON итога, его читает cron и отправка владельцу.
config({ quiet: true })

const USAGE = 'Использование: audit-chain.ts verify [--expect-seq N --expect-hash H] [--no-audit] | seal'

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index === -1 ? undefined : argv[index + 1]
}

async function main(): Promise<void> {
  const [command, ...argv] = process.argv.slice(2)
  const known = new Set(['--expect-seq', '--expect-hash', '--no-audit'])
  const unknown = argv.filter((arg, index) => arg.startsWith('--') && !known.has(arg) && !known.has(argv[index - 1] ?? ''))
  if ((command !== 'verify' && command !== 'seal') || unknown.length > 0 || (command === 'seal' && argv.length > 0)) {
    console.error(USAGE)
    process.exit(2)
  }

  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('Не задан DATABASE_URL')
    process.exit(2)
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })

  try {
    if (command === 'seal') {
      const seal = await auditSeal(prisma)
      console.log(JSON.stringify(seal))
      console.error(`Печать № ${seal.id}: строка № ${seal.headSeq}, строк в журнале ${seal.count}`)
      return
    }

    let externalSeal
    try {
      externalSeal = parseExternalSeal(option(argv, '--expect-seq'), option(argv, '--expect-hash')) ?? undefined
    } catch (error) {
      console.error(error instanceof Error ? error.message : error)
      process.exit(2)
    }

    const report = await verifyChain(prisma, { externalSeal })
    if (!argv.includes('--no-audit')) {
      await writeAudit(
        { userId: null, action: 'audit.verify', objectType: 'AuditLog', objectId: 'chain', payload: auditVerifyPayload(report, 'script') },
        prisma,
      )
    }

    console.log(JSON.stringify(toVerifyDto(report)))
    if (externalSeal && externalSeal.headSeq <= report.anchorSeq && report.anchorSeq > 0n) {
      console.error(`Печать вне базы (№ ${externalSeal.headSeq}) указывает в часть журнала, вычищенную по сроку: сверять не с чем.`)
    }
    if (report.ok) {
      console.error(
        `\x1b[32mЖурнал цел:\x1b[0m строк ${report.checked}, голова № ${report.headSeq}, печатей сверено ${report.sealsChecked}`,
      )
      return
    }
    console.error(`\x1b[31mЖурнал нарушен (${report.code}):\x1b[0m ${report.reason}`)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error('Проверка журнала не выполнена:', error instanceof Error ? error.message : error)
  process.exit(2)
})
