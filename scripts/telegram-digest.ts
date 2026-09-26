/**
 * Рассылка сводки «что горит у меня» по каналам уведомлений (решения 102, 144).
 *
 *   npm run telegram:digest               разослать всем привязанным активным сотрудникам
 *   npm run telegram:digest -- --dry-run  только напечатать сводки, никуда не отправляя
 *
 * Кому: у кого есть привязка хотя бы одного канала (личный кабинет → «Каналы
 * уведомлений» — Telegram, MAX или VK), учётная запись активна и роль видит сводку.
 * Пустые сводки («ничего не горит») не шлются. Что: то же, что «сегодня»/`/today`
 * в чате с ботом, — `digestFor` из `telegram.service.ts` (решение 120), один текст
 * для всех каналов. Доставка — `notify-channels.service.ts`: основной канал
 * сотрудника, при неудаче — по очереди остальные привязанные (решение 144).
 *
 * Ни один канал не настроен — без --dry-run скрипт ничего не делает и выходит
 * с кодом 0: расписание на сервере может стоять и до подключения бота. Сбой
 * доставки одному человеку не останавливает остальных; код выхода 1 — только
 * если не ушло ни одно из сообщений, которые должны были уйти.
 *
 * На стенде — cron владельца сервера через сервис migrate (docs/DEPLOY.md).
 */

import 'dotenv/config'
import { prisma } from '@/shared/db/prisma'
import { anyChannelConfigured, sendDigests } from '@/modules/notify-channels/notify-channels.service'

function parseMode(argv: readonly string[]): { dryRun: boolean } {
  const unknown = argv.filter((arg) => arg !== '--dry-run')
  if (unknown.length > 0) {
    console.error(`Неизвестные параметры: ${unknown.join(' ')}. Есть только --dry-run.`)
    process.exit(2)
  }
  return { dryRun: argv.includes('--dry-run') }
}

async function main(): Promise<number> {
  const { dryRun } = parseMode(process.argv.slice(2))
  if (!process.env.DATABASE_URL) {
    console.error('Не задан DATABASE_URL')
    return 1
  }
  if (!dryRun && !anyChannelConfigured()) {
    console.log('Ни один канал не настроен (Telegram/MAX/VK) — рассылки нет.')
    return 0
  }
  if (!process.env.AUTH_URL && !process.env.APP_BASE_URL) {
    console.warn('Не задан ни AUTH_URL, ни APP_BASE_URL — сводки уйдут без ссылок на стенд.')
  }

  const summary = await sendDigests({ dryRun })
  const verb = dryRun ? 'напечатано' : 'отправлено'
  console.log(
    `Сводка ${new Date().toISOString()}: получателей ${summary.recipients}, ${verb} ${summary.sent}, ` +
      `пустых ${summary.empty}, роль без сводки ${summary.skipped}, сбоев ${summary.failed}`,
  )
  const expected = summary.sent + summary.failed
  return expected > 0 && summary.sent === 0 ? 1 : 0
}

main()
  .then(async (code) => {
    await prisma.$disconnect()
    process.exit(code)
  })
  .catch(async (error: unknown) => {
    // Без подробностей данных: только тип и сообщение.
    console.error('Рассылка не выполнена:', error instanceof Error ? error.message : String(error))
    await prisma.$disconnect().catch(() => {})
    process.exit(1)
  })
