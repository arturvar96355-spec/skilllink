import { writeAudit } from '@/shared/audit/audit'
import { assertCan } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import { DUPLICATES } from '@/shared/config/data-quality.config'
import type {
  DuplicateDismissalDto,
  DuplicateEntityType,
  DuplicatePairDto,
  DuplicateRecordDto,
  DuplicatesMetaDto,
  QualityReportDto,
} from '@/shared/contracts/data-quality'
import { DUPLICATE_ENTITY_TYPES } from '@/shared/contracts/data-quality'
import { PROGRAM_LEVEL_LABELS } from '@/shared/contracts/labels'
import type { ProgramLevel } from '@/shared/contracts/enums'
import { validationError } from '@/shared/http/errors'
import { toIsoRequired } from '@/shared/utils/date'
import * as repo from './data-quality.repo'
import type { DismissDuplicateInput, DuplicatesQuery } from './data-quality.schema'
import {
  BLOCKING_KEYS,
  blockingPairs,
  findPairs,
  pairKey,
  scoreProducts,
  scorePrograms,
  scoreSkills,
  scoreUniversities,
  type FoundPair,
  type PairScore,
} from './duplicates.rules'
import { computeQualityReport, hrefOf, type DuplicateSummary } from './quality.rules'

/**
 * Качество данных (решение 134): дубли, «не дубль», отчёт качества.
 * Смотреть — право ANALYTICS (представителю вуза нет: это сравнение чужих вузов);
 * отмечать «не дубль» — WRITE; сливать вузы — ADMIN (модуль universities).
 */

interface EntityPairs {
  pairs: Array<FoundPair<{ id: string }> & { record: [DuplicateRecordDto, DuplicateRecordDto] }>
  compared: number
  candidateSource: DuplicatesMetaDto['candidateSource']
}

interface EntityOptions {
  threshold: number
  includeArchived: boolean
}

/**
 * Пары одной сущности. Небольшой справочник сравнивается «все со всеми»; больше
 * DUPLICATES.allPairsLimit записей — кандидатов отбирает база (`%` по GIN-индексу),
 * к ним добавляются пары по ключам (синонимы, аббревиатуры, ИНН), которые
 * триграммами не найти.
 */
async function pairsOf<T extends { id: string }>(
  entity: DuplicateEntityType,
  items: T[],
  score: (a: T, b: T) => PairScore | null,
  keys: (item: T) => readonly string[],
  record: (item: T) => DuplicateRecordDto,
  options: EntityOptions,
): Promise<EntityPairs> {
  let candidates: Array<readonly [string, string]> | undefined
  let candidateSource: DuplicatesMetaDto['candidateSource'] = 'all-pairs'
  if (items.length > DUPLICATES.allPairsLimit && (await repo.hasTrigramExtension())) {
    const fromDb = await repo.trigramCandidatePairs(entity, options.threshold, options.includeArchived)
    candidates = [...fromDb, ...blockingPairs(items, keys)]
    candidateSource = 'pg_trgm'
  }
  const found = findPairs(items, score, { threshold: options.threshold, candidates })
  return {
    pairs: found.map((pair) => ({ ...pair, record: [record(pair.a), record(pair.b)] })),
    compared: items.length,
    candidateSource,
  }
}

async function entityPairs(entity: DuplicateEntityType, options: EntityOptions): Promise<EntityPairs> {
  switch (entity) {
    case 'university':
      return pairsOf(entity, await repo.loadUniversities(options.includeArchived), scoreUniversities, BLOCKING_KEYS.university,
        (item) => ({ id: item.id, name: item.name, hint: item.city, href: hrefOf('university', item.id) }), options)
    case 'skill':
      return pairsOf(entity, await repo.loadSkills(), scoreSkills, BLOCKING_KEYS.skill,
        (item) => ({ id: item.id, name: item.name, hint: item.category, href: hrefOf('skill', item.id) }), options)
    case 'program':
      return pairsOf(entity, await repo.loadPrograms(options.includeArchived), scorePrograms, BLOCKING_KEYS.program,
        (item) => ({
          id: item.id,
          name: item.name,
          hint: `${item.universityName}, ${PROGRAM_LEVEL_LABELS[item.level as ProgramLevel] ?? item.level}`,
          href: hrefOf('program', item.id),
        }), options)
    case 'product':
      return pairsOf(entity, await repo.loadProducts(), scoreProducts, BLOCKING_KEYS.product,
        (item) => ({ id: item.id, name: item.name, hint: item.category, href: hrefOf('product', item.id) }), options)
  }
}

export async function findDuplicates(
  user: CurrentUser,
  query: DuplicatesQuery,
): Promise<{ data: DuplicatePairDto[]; meta: DuplicatesMetaDto }> {
  assertCan(user, 'ANALYTICS')
  const options = { threshold: query.threshold, includeArchived: query.includeArchived ?? false }
  const [result, dismissed] = await Promise.all([entityPairs(query.entity, options), repo.findDismissedKeys(query.entity)])

  const isDismissed = (pair: { a: { id: string }; b: { id: string } }) => dismissed.has(pairKey(pair.a.id, pair.b.id).join('|'))
  const visible = result.pairs.filter((pair) => query.includeDismissed || !isDismissed(pair))
  return {
    data: visible.slice(0, DUPLICATES.maxPairs).map((pair) => ({
      entity: query.entity,
      a: pair.record[0],
      b: pair.record[1],
      score: pair.score,
      method: pair.method,
      reasons: pair.reasons,
      dismissed: isDismissed(pair),
    })),
    meta: {
      entity: query.entity,
      threshold: query.threshold,
      compared: result.compared,
      candidateSource: result.candidateSource,
      total: visible.length,
      dismissedHidden: query.includeDismissed ? 0 : result.pairs.length - visible.length,
    },
  }
}

function toDismissalDto(row: repo.DismissalRow): DuplicateDismissalDto {
  return {
    id: row.id,
    entity: row.entity as DuplicateEntityType,
    firstId: row.firstId,
    secondId: row.secondId,
    comment: row.comment,
    dismissedBy: row.dismissedBy,
    createdAt: toIsoRequired(row.createdAt),
  }
}

/** Отметить пару «не дубль». ADMIN и MANAGER. Порядок записей в паре не важен. */
export async function dismiss(user: CurrentUser, input: DismissDuplicateInput): Promise<DuplicateDismissalDto> {
  assertCan(user, 'WRITE')
  const [firstId, secondId] = pairKey(input.firstId, input.secondId)
  if ((await repo.countExisting(input.entity, [firstId, secondId])) !== 2) {
    throw validationError('Пара не найдена', [{ field: 'secondId', message: 'Одной из записей нет в справочнике' }])
  }
  const { row, created } = await repo.upsertDismissal({
    entity: input.entity,
    firstId,
    secondId,
    comment: input.comment ?? null,
    userId: user.id,
  })
  if (created) {
    await writeAudit({
      userId: user.id,
      action: 'duplicate.dismiss',
      objectType: 'DuplicateDismissal',
      objectId: row.id,
      payload: { entity: input.entity, firstId, secondId },
    })
  }
  return toDismissalDto(row)
}

/** Отчёт «Качество справочника». Дубли — пары выше порога по умолчанию без «не дубль». */
export async function report(user: CurrentUser, now: Date = new Date()): Promise<QualityReportDto> {
  assertCan(user, 'ANALYTICS')
  const options = { threshold: DUPLICATES.trigramThreshold, includeArchived: false }
  const [input, ...perEntity] = await Promise.all([
    repo.loadReportInput(now),
    ...DUPLICATE_ENTITY_TYPES.map(async (entity) => {
      const [result, dismissed] = await Promise.all([entityPairs(entity, options), repo.findDismissedKeys(entity)])
      const pairs = result.pairs.filter((pair) => !dismissed.has(pairKey(pair.a.id, pair.b.id).join('|')))
      return [entity, { pairs: pairs.length, ids: new Set(pairs.flatMap((pair) => [pair.a.id, pair.b.id])) }] as const
    }),
  ])
  const duplicates = Object.fromEntries(perEntity) as unknown as DuplicateSummary
  return computeQualityReport(input, duplicates, now)
}
