/**
 * Симуляция обучения рекомендаций (решение 119): 90 дней решений менеджеров
 * на объектах демо-набора — как меняется вес каждого правила.
 *
 *   npm run recs:simulate                       объекты из базы (.env), зерно 119
 *   npm run recs:simulate -- --seed 7 --days 120
 *   npm run recs:simulate -- --synthetic        без базы: придуманные объекты
 *   npm run recs:simulate -- --json out.json    цифры для графика
 *
 * База только читается — берутся действующие связки, программы и навыки
 * с рыночными данными; решения моделируются в памяти, «на копии». Менеджеры
 * систематически отклоняют «связку без движения» (выполняют 10 %), остальные
 * правила — от 55 до 75 %. Арифметика — та же `applyEvent`, что зеркалит SQL.
 * Детерминированный генератор с зерном: одинаковые аргументы — одинаковые цифры.
 */
import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { RECOMMENDATION_LEARNING } from '@/shared/config/analytics.config'
import {
  DAY_MS,
  credibleInterval90,
  ruleProbability,
  scoreRecommendation,
} from '@/modules/recommendations/recommendations.learning'
import { ruleLabel } from '@/modules/recommendations/recommendations.reasons'
import { RULE_DISPLAY_ORDER } from '@/modules/recommendations/recommendations.rules'
import {
  DEFAULT_ACCEPT_RATES,
  simulateDecisions,
  syntheticCandidates,
  type SimulationCandidate,
} from '@/modules/recommendations/recommendations.simulation'

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const fmt = (value: number) => value.toFixed(2).replace('.', ',')

/** Короткие подписи для столбцов таблицы. */
const SHORT: Record<string, string> = {
  'stage.overdue': 'Просрочка',
  'skill.critical-gap-with-product': 'Дефицит',
  'cooperation.no-product': 'Без продукта',
  'program.missing-metrics': 'Нет данных',
  'cooperation.stalled': 'Застой',
}
const pad = (text: string, width: number) => text.padEnd(width)

async function loadCandidates(): Promise<{ candidates: SimulationCandidate[]; source: string }> {
  if (process.argv.includes('--synthetic') || !process.env.DATABASE_URL) {
    return { candidates: syntheticCandidates(), source: 'придуманные объекты (--synthetic)' }
  }
  const { loadSimulationCandidates } = await import('@/modules/recommendations/recommendations.stats.repo')
  const { prisma } = await import('@/shared/db/prisma')
  try {
    const candidates = await loadSimulationCandidates()
    if (candidates.length === 0) return { candidates: syntheticCandidates(), source: 'база пуста — придуманные объекты' }
    return { candidates, source: 'объекты демо-набора из базы (только чтение)' }
  } finally {
    await prisma.$disconnect()
  }
}

async function main(): Promise<void> {
  const seed = Number(argument('seed') ?? 119)
  const days = Number(argument('days') ?? 90)
  const { candidates, source } = await loadCandidates()
  const start = new Date(Date.UTC(2026, 5, 1))
  const result = simulateDecisions({ candidates, days, start, seed })
  const rules = RULE_DISPLAY_ORDER.filter((rule) => rule in result.totals)

  console.log(`Симуляция обучения рекомендаций: ${days} дн., зерно ${seed}`)
  console.log(`Объекты: ${source}, кандидатов «правило × объект»: ${candidates.length}`)
  console.log(
    `Полураспад ${RECOMMENDATION_LEARNING.halfLifeDays} дн., пулинг k = ${RECOMMENDATION_LEARNING.poolingStrength}, ` +
      `пауза после отклонения ${RECOMMENDATION_LEARNING.dismissPauseDays} дн.\n`,
  )

  console.log('Доля выполненных, которую задаёт модель менеджера:')
  for (const rule of rules) console.log(`  ${pad(ruleLabel(rule), 34)} ${Math.round((DEFAULT_ACCEPT_RATES[rule] ?? 0.5) * 100)} %`)

  console.log('\nВес правила (вероятность полезности, общий уровень) по неделям:')
  const header = ['день', ...rules.map((rule) => SHORT[rule] ?? rule)]
  console.log('  ' + header.map((cell, index) => pad(cell, index === 0 ? 6 : 14)).join(''))
  for (const snapshot of result.snapshots) {
    const cells = [String(snapshot.day), ...rules.map((rule) => fmt(snapshot.weights[rule] ?? 0.5))]
    console.log('  ' + cells.map((cell, index) => pad(cell, index === 0 ? 6 : 14)).join(''))
  }

  const end = new Date(start.getTime() + days * DAY_MS)
  console.log(`\nИтог на ${days}-й день:`)
  console.log(
    '  ' +
      [pad('правило', 34), pad('показано', 10), pad('выполнено', 11), pad('отклонено', 11), pad('вес', 7), '90 % интервал'].join(''),
  )
  const summary = rules.map((rule) => {
    const probability = ruleProbability(result.state, rule, { universityId: null, managerId: null }, end)
    const [low, high] = credibleInterval90(probability.posterior)
    const totals = result.totals[rule]!
    console.log(
      '  ' +
        [
          pad(ruleLabel(rule), 34),
          pad(String(totals.shown), 10),
          pad(String(totals.done), 11),
          pad(String(totals.dismissed), 11),
          pad(fmt(probability.p), 7),
          `${fmt(low)}–${fmt(high)}`,
        ].join(''),
    )
    return { rule, ...totals, p: probability.p, ci90: [low, high], trialsEff: probability.trialsEff }
  })

  // Балл одинаковой по силе рекомендации — день 0 против последнего дня.
  const sample = { ruleKey: 'cooperation.stalled', relatedData: { idleDays: 21 }, priority: 'MEDIUM' as const }
  const scopes = { universityId: null, managerId: null }
  const before = scoreRecommendation(sample, scopes, new Map(), start).score
  const after = scoreRecommendation(sample, scopes, result.state, end).score
  const overdue = scoreRecommendation(
    { ruleKey: 'stage.overdue', relatedData: { daysOverdue: 5 }, priority: 'MEDIUM' },
    scopes,
    result.state,
    end,
  ).score
  console.log(
    `\nБалл «связка без движения 21 дн.» (средний приоритет): ${fmt(before)} → ${fmt(after)}; ` +
      `для сравнения «просрочка 5 дн.» того же приоритета — ${fmt(overdue)}.`,
  )
  console.log(`Событий записано: ${result.events.length} (показы и успехи на уровнях общий / вуз / менеджер).`)

  const jsonPath = argument('json')
  if (jsonPath) {
    writeFileSync(
      jsonPath,
      JSON.stringify(
        { seed, days, halfLifeDays: RECOMMENDATION_LEARNING.halfLifeDays, snapshots: result.snapshots, summary },
        null,
        2,
      ),
    )
    console.log(`Цифры для графика: ${jsonPath}`)
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
