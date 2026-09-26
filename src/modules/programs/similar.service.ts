import { z } from '@/shared/zod'
import { assertCan } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import { SIMILAR_PROGRAMS } from '@/shared/config/data-quality.config'
import type { SimilarProgramsDto } from '@/shared/contracts/data-quality'
import { notFound } from '@/shared/http/errors'
import { loadProgramsForSimilarity } from './similar.repo'
import { findSimilarPrograms } from './similar.rules'

export const similarProgramsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(SIMILAR_PROGRAMS.maxLimit).default(SIMILAR_PROGRAMS.defaultLimit),
})

export type SimilarProgramsQuery = z.infer<typeof similarProgramsQuerySchema>

/**
 * Похожие программы (решение 134) — аналитика: программы всех вузов рядом друг
 * с другом, поэтому право ANALYTICS, представителю вуза — 403. Считается на лету:
 * на демо-данных расчёт — единицы миллисекунд, кэш не нужен (решение 134).
 */
export async function similarPrograms(
  user: CurrentUser,
  programId: string,
  query: SimilarProgramsQuery,
): Promise<SimilarProgramsDto> {
  assertCan(user, 'ANALYTICS')
  const programs = await loadProgramsForSimilarity(programId)
  if (!programs.some((program) => program.id === programId)) throw notFound('Программа не найдена')
  return findSimilarPrograms(programId, programs, query.limit)
}
