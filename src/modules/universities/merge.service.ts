import { writeAudit } from '@/shared/audit/audit'
import { assertCan } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import type {
  SurvivorshipEntryDto,
  UniversityMergeDto,
  UniversityMergeUndoDto,
} from '@/shared/contracts/data-quality'
import { notFound, validationError } from '@/shared/http/errors'
import { toIso, toIsoRequired } from '@/shared/utils/date'
import * as repo from './merge.repo'
import { countMoved, fieldsTakenFromSource, type MovedIds, type UniversityFields } from './merge.rules'
import type { MergeUniversitiesInput } from './merge.schema'

/**
 * Слияние вуза-дубля в другой (решение 134). Только администратор: это перенос
 * всей истории отношений с вузом, как и объединение навыков (решение 107).
 */

function toMergeDto(row: repo.MergeRow): UniversityMergeDto {
  const moved = row.moved as unknown as MovedIds
  return {
    id: row.id,
    sourceId: row.sourceId,
    targetId: row.targetId,
    mergedBy: row.mergedBy,
    mergedAt: toIsoRequired(row.mergedAt),
    undoUntil: toIsoRequired(row.undoUntil),
    undoneAt: toIso(row.undoneAt),
    moved: countMoved(moved),
    survivorship: row.survivorship as unknown as SurvivorshipEntryDto[],
    demotedPrimaryContacts: moved.demotedContacts.length,
  }
}

export async function merge(
  user: CurrentUser,
  input: MergeUniversitiesInput,
  now: Date = new Date(),
): Promise<UniversityMergeDto> {
  assertCan(user, 'ADMIN')
  const outcome = await repo.mergeUniversities({
    sourceId: input.sourceId,
    targetId: input.targetId,
    userId: user.id,
    rules: input.fieldRules ?? {},
    manual: (input.manualValues ?? {}) as Partial<UniversityFields>,
    now,
  })
  if (outcome.status === 'not-found') {
    const field = outcome.which === 'source' ? 'sourceId' : 'targetId'
    throw validationError('Вуз не найден', [{ field, message: 'Такого вуза нет в реестре' }])
  }

  const dto = toMergeDto(outcome.merge)
  // В журнал — имена полей и счётчики, без значений: значения — в журнале слияния,
  // а в контактах, которые переносятся, есть персональные данные.
  await writeAudit({
    userId: user.id,
    action: 'university.merge',
    objectType: 'University',
    objectId: dto.targetId,
    payload: {
      mergeId: dto.id,
      sourceId: dto.sourceId,
      sourceName: outcome.sourceName,
      moved: { ...dto.moved },
      fieldsFromSource: fieldsTakenFromSource(dto.survivorship),
    },
  })
  return dto
}

export async function undo(user: CurrentUser, mergeId: string, now: Date = new Date()): Promise<UniversityMergeUndoDto> {
  assertCan(user, 'ADMIN')
  const outcome = await repo.undoMerge(mergeId, user.id, now)
  if (outcome.status === 'not-found') throw notFound('Слияние не найдено')

  const dto = toMergeDto(outcome.merge)
  await writeAudit({
    userId: user.id,
    action: 'university.merge.undo',
    objectType: 'University',
    objectId: dto.targetId,
    payload: {
      mergeId: dto.id,
      sourceId: dto.sourceId,
      returned: { ...outcome.returned },
      restoredFields: outcome.restored,
      keptFields: outcome.kept,
    },
  })
  return { merge: dto, returned: outcome.returned, restoredFields: outcome.restored, keptFields: outcome.kept }
}
