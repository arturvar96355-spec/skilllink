/**
 * Отчёт «работают ли рекомендации» по журналу сигналов текущей базы (решение 126).
 *
 *   npm run recs:experiment-report
 *
 * Тот же расчёт, что и `GET /api/recommendations/experiment`, но в консоль и без
 * запроса к серверу — заготовка для слайда на защите. Ничего не пишет в базу
 * (кроме того, что читает журнал как есть — исходы, которые уже решены, но ещё
 * не сохранены пересборкой, считаются в памяти).
 */

import 'dotenv/config'
import { buildReport } from '@/modules/recommendations/experiment/experiment.service'
import { prisma } from '@/shared/db/prisma'
import { EXPERIMENT_STATUS_LABELS, type ExperimentStatsDto } from '@/shared/contracts/recommendation-experiment'

function pct(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)} %`
}

function ci(value: { low: number; high: number } | null): string {
  return value === null ? '—' : `[${pct(value.low)}; ${pct(value.high)}]`
}

function printStats(label: string, stats: ExperimentStatsDto): void {
  console.log(`\n${label}`)
  console.log(`  назначено: treatment ${stats.nTreatment} (в ожидании ${stats.pendingTreatment}), ` +
    `control ${stats.nControl} (в ожидании ${stats.pendingControl})`)
  console.log(`  конверсия: treatment ${pct(stats.convT)}, control ${pct(stats.convC)}`)
  console.log(`  прирост: ${pct(stats.lift)} абсолютный, ` +
    `${stats.relativeLift === null ? '—' : `${(stats.relativeLift * 100).toFixed(1)} %`} относительный, ` +
    `95 % интервал ${ci(stats.ci)}`)
  if (stats.days) {
    console.log(`  дни до перехода: treatment ${stats.days.meanTreatment.toFixed(1)}, ` +
      `control ${stats.days.meanControl.toFixed(1)}, разность ${stats.days.diff.toFixed(1)} ` +
      `[${stats.days.ci.low.toFixed(1)}; ${stats.days.ci.high.toFixed(1)}]`)
  }
  console.log(`  последовательная проверка: ${stats.sequential.decision} ` +
    `(LLR ${stats.sequential.llr.toFixed(2)}, пороги [${stats.sequential.lower.toFixed(2)}; ${stats.sequential.upper.toFixed(2)}])`)
  console.log(`  статус: ${EXPERIMENT_STATUS_LABELS[stats.status]}`)
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('Не задан DATABASE_URL')
    process.exitCode = 1
    return
  }
  const report = await buildReport(new Date())

  console.log('Работают ли рекомендации — отчёт по журналу сигналов (решение 126)')
  console.log(`Эксперимент: ${report.enabled ? 'включён' : 'выключен (новые сигналы — все treatment)'}, ` +
    `доля контроля ${pct(report.controlShare)}, окно исхода ${report.horizonDays} дн.`)
  console.log(`Журнал: всего сигналов ${report.journal.total}, по хешу ${report.journal.randomized}`)
  for (const [assignedBy, count] of Object.entries(report.journal.byAssignment)) {
    console.log(`  ${assignedBy}: ${count}`)
  }
  if (report.warnings.length > 0) {
    console.log('\nОговорки:')
    for (const warning of report.warnings) console.log(`  - ${warning}`)
  }

  printStats('Всего по всем правилам', report.overall)
  for (const rule of report.rules) {
    if (rule.nTreatment === 0 && rule.nControl === 0) continue
    printStats(`${rule.label} (${rule.ruleType})${rule.controlEligible ? '' : ' — из контроля исключено'}`, rule)
  }
  console.log(`\nОтчёт составлен: ${report.generatedAt}`)
  await prisma.$disconnect()
}

main().catch((error) => {
  console.error('Отчёт по эксперименту упал:', error)
  process.exitCode = 1
})
