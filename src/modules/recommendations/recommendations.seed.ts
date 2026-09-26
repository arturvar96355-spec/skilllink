import { prisma } from '@/shared/db/prisma'
import { RECOMMENDATION_LEARNING } from '@/shared/config/analytics.config'
import { DAY_MS, indexStats, ruleProbability, statsKey } from './recommendations.learning'
import { rescoreOpen } from './recommendations.learning.service'
import { ruleLabel } from './recommendations.reasons'
import { RULE_DISPLAY_ORDER } from './recommendations.rules'
import { simulateDecisions } from './recommendations.simulation'
import * as statsRepo from './recommendations.stats.repo'

/** Зерно истории демо-данных: перезаливка даёт те же веса. */
const SEED = 119
const HISTORY_DAYS = 90

/**
 * История решений по правилам для демо-набора (решение 119).
 *
 * На свежем стенде статистики нет — все правила весят 0,5, и обучение не видно.
 * Здесь 90 дней решений менеджеров моделируются на объектах демо-набора
 * (`simulateDecisions`: застой систематически отклоняют) и записываются в базу
 * **тем же SQL**, что пишет приложение, в хронологическом порядке. Затем
 * записанное сверяется с формулой `applyEvent` — если SQL и зеркало разошлись,
 * перезаливка падает. Сами рекомендации не создаются: история — только в счётчиках.
 *
 * Вызывается в конце сида, после пересборки: показы текущих рекомендаций
 * добавляются поверх истории, и балл открытых пересчитывается.
 */
export async function seedRecommendationStats(now: Date): Promise<void> {
  console.log('Статистика правил рекомендаций (история 90 дней)...')
  await statsRepo.wipeRuleStats()

  const candidates = await statsRepo.loadSimulationCandidates()
  const start = new Date(now.getTime() - (HISTORY_DAYS + 1) * DAY_MS)
  // Последние 5 дней истории — только решения: к началу показа все старые
  // рекомендации решены, и вес правила не занижен ещё не решёнными.
  const result = simulateDecisions({ candidates, days: HISTORY_DAYS, start, seed: SEED, quietTailDays: 5 })

  // Пачки по моменту и виду события — в том порядке, в каком они случились.
  const batches = new Map<string, { kind: 'show' | 'success'; at: Date; deltas: statsRepo.RuleStatsDelta[] }>()
  for (const event of result.events) {
    const key = `${event.at.toISOString()}|${event.kind}`
    const batch = batches.get(key) ?? { kind: event.kind, at: event.at, deltas: [] }
    batch.deltas.push({ ruleType: event.ruleKey, scopeType: event.scopeType, scopeId: event.scopeId, count: 1 })
    batches.set(key, batch)
  }
  const ordered = [...batches.values()].sort(
    (a, b) => a.at.getTime() - b.at.getTime() || (a.kind === b.kind ? 0 : a.kind === 'show' ? -1 : 1),
  )
  for (const batch of ordered) await statsRepo.recordRuleEvents(batch.kind, batch.deltas, batch.at)

  // SQL и формула — одна арифметика: сверка каждой строки.
  const written = await statsRepo.loadRuleStats()
  const mismatched = written.filter((row) => {
    const expected = result.state.get(statsKey(row.ruleType, row.scopeType, row.scopeId))
    return (
      !expected ||
      expected.trials !== row.trials ||
      expected.successes !== row.successes ||
      Math.abs(expected.trialsEff - row.trialsEff) > 1e-9 ||
      Math.abs(expected.successesEff - row.successesEff) > 1e-9
    )
  })
  if (mismatched.length > 0 || written.length !== result.state.size) {
    throw new Error(
      `Статистика правил: SQL и формула разошлись в ${mismatched.length} строках из ${written.length}`,
    )
  }

  // Показы рекомендаций, созданных пересборкой сида, — поверх истории.
  const shown = await prisma.recommendation.findMany({
    where: { shownAt: { not: null } },
    select: { id: true, ruleKey: true, objectType: true, objectId: true, cooperationId: true },
    orderBy: { id: 'asc' },
  })
  await statsRepo.recordShows(shown, now)
  await rescoreOpen(now)

  const index = indexStats(await statsRepo.loadRuleStats())
  console.log(`  событий: ${result.events.length}, строк статистики: ${written.length}`)
  for (const rule of RULE_DISPLAY_ORDER) {
    const probability = ruleProbability(index, rule, { universityId: null, managerId: null }, now)
    console.log(
      `  ${ruleLabel(rule)}: вес ${probability.p.toFixed(2).replace('.', ',')} ` +
        `(эффективно показов ${probability.trialsEff.toFixed(1).replace('.', ',')}, полезных ` +
        `${probability.successesEff.toFixed(1).replace('.', ',')}; полураспад ${RECOMMENDATION_LEARNING.halfLifeDays} дн.)`,
    )
  }
}
