import { SIMILAR_PROGRAMS } from '@/shared/config/data-quality.config'
import type { SimilarProgramDto, SimilarProgramsDto, SkillRefDto } from '@/shared/contracts/data-quality'
import type { SkillImportance } from '@/shared/contracts/enums'
import { directionGroup } from '@/modules/skills/skills.rules'

/**
 * Похожие программы (решение 134). Чистые функции.
 *
 * Вектор программы: навык → важность × idf. idf = ln((1 + N) / (1 + df)) + 1, где N —
 * число программ в расчёте, df — сколько из них дают навык: навык, который есть почти
 * везде (SQL), весит меньше редкого (Kubernetes) и не делает похожими всех подряд.
 * Сходство — косинус векторов. Итог:
 *   score = (1 − bonusDirection − bonusLevel) × cos + bonusDirection × [то же направление]
 *           + bonusLevel × [тот же уровень].
 * Без общих навыков (cos = 0) программа похожей не считается, какие бы ни были бонусы.
 */

export interface ProgramForSimilarity {
  id: string
  name: string
  universityId: string
  universityName: string
  level: string
  code: string | null
  direction: string | null
  skills: Array<{ skillId: string; skillName: string; importance: SkillImportance }>
}

const round3 = (value: number) => Math.round(value * 1000) / 1000

export function inverseDocumentFrequency(programs: readonly ProgramForSimilarity[]): Map<string, number> {
  const df = new Map<string, number>()
  for (const program of programs) {
    for (const skillId of new Set(program.skills.map((skill) => skill.skillId))) df.set(skillId, (df.get(skillId) ?? 0) + 1)
  }
  const total = programs.length
  return new Map([...df].map(([skillId, count]) => [skillId, Math.log((1 + total) / (1 + count)) + 1]))
}

export function skillVector(program: ProgramForSimilarity, idf: ReadonlyMap<string, number>): Map<string, number> {
  return new Map(
    program.skills.map((skill) => [
      skill.skillId,
      SIMILAR_PROGRAMS.importanceWeights[skill.importance] * (idf.get(skill.skillId) ?? 1),
    ]),
  )
}

export function cosine(left: ReadonlyMap<string, number>, right: ReadonlyMap<string, number>): number {
  let dot = 0
  for (const [key, value] of left) dot += value * (right.get(key) ?? 0)
  const norm = (vector: ReadonlyMap<string, number>) => Math.sqrt([...vector.values()].reduce((sum, value) => sum + value * value, 0))
  const denominator = norm(left) * norm(right)
  return denominator === 0 ? 0 : dot / denominator
}

/** То же направление: одна укрупнённая группа по коду («09.03.04» и «09.04.01») или одинаковое направление. */
export function sameDirection(left: ProgramForSimilarity, right: ProgramForSimilarity): boolean {
  const leftGroup = directionGroup(left.code)
  if (leftGroup !== null && leftGroup === directionGroup(right.code)) return true
  const normalize = (value: string | null) => value?.trim().toLocaleLowerCase('ru') || null
  const leftDirection = normalize(left.direction)
  return leftDirection !== null && leftDirection === normalize(right.direction)
}

export function similarityScore(cos: number, direction: boolean, level: boolean): number {
  const { directionBonus, levelBonus } = SIMILAR_PROGRAMS
  return (1 - directionBonus - levelBonus) * cos + (direction ? directionBonus : 0) + (level ? levelBonus : 0)
}

/** Похожие на программу `targetId` среди `programs` (сама программа исключается). */
export function findSimilarPrograms(
  targetId: string,
  programs: readonly ProgramForSimilarity[],
  limit: number,
): SimilarProgramsDto {
  const target = programs.find((program) => program.id === targetId)
  if (!target) return { programId: targetId, items: [], missingSummary: [], explanation: EXPLANATION }
  const idf = inverseDocumentFrequency(programs)
  const targetVector = skillVector(target, idf)
  const targetSkills = new Set(target.skills.map((skill) => skill.skillId))

  const items: SimilarProgramDto[] = []
  for (const other of programs) {
    if (other.id === target.id) continue
    const cos = cosine(targetVector, skillVector(other, idf))
    if (cos <= 0) continue
    const direction = sameDirection(target, other)
    const level = target.level === other.level
    const ref = (skill: ProgramForSimilarity['skills'][number]): SkillRefDto => ({ id: skill.skillId, name: skill.skillName })
    items.push({
      program: {
        id: other.id,
        name: other.name,
        universityId: other.universityId,
        universityName: other.universityName,
        level: other.level,
        direction: other.direction,
      },
      score: round3(similarityScore(cos, direction, level)),
      cosine: round3(cos),
      sameDirection: direction,
      sameLevel: level,
      sharedSkills: other.skills.filter((skill) => targetSkills.has(skill.skillId)).map(ref).sort(byName),
      missingSkills: other.skills.filter((skill) => !targetSkills.has(skill.skillId)).map(ref).sort(byName),
    })
  }
  items.sort((left, right) => right.score - left.score || left.program.name.localeCompare(right.program.name, 'ru'))
  const top = items.slice(0, limit)
  return { programId: targetId, items: top, missingSummary: summarizeMissing(top, programs), explanation: EXPLANATION }
}

const byName = (left: SkillRefDto, right: SkillRefDto) => left.name.localeCompare(right.name, 'ru')

/**
 * «Чего не хватает»: навык, которого нет у программы, весит Σ по похожим
 * (сходство × вес важности навыка в той программе). Чем больше похожих программ
 * его дают и чем они ближе — тем выше он в подсказке.
 */
function summarizeMissing(
  items: readonly SimilarProgramDto[],
  programs: readonly ProgramForSimilarity[],
): SimilarProgramsDto['missingSummary'] {
  const byId = new Map(programs.map((program) => [program.id, program]))
  const summary = new Map<string, { name: string; programCount: number; weight: number }>()
  for (const item of items) {
    const importance = new Map(byId.get(item.program.id)?.skills.map((skill) => [skill.skillId, skill.importance]))
    for (const skill of item.missingSkills) {
      const entry = summary.get(skill.id) ?? { name: skill.name, programCount: 0, weight: 0 }
      entry.programCount += 1
      entry.weight += item.score * SIMILAR_PROGRAMS.importanceWeights[importance.get(skill.id) ?? 'MEDIUM']
      summary.set(skill.id, entry)
    }
  }
  return [...summary]
    .map(([id, entry]) => ({ id, name: entry.name, programCount: entry.programCount, weight: round3(entry.weight) }))
    .sort((left, right) => right.weight - left.weight || left.name.localeCompare(right.name, 'ru'))
    .slice(0, SIMILAR_PROGRAMS.missingLimit)
}

const decimal = (value: number) => String(round3(value)).replace('.', ',')
const { directionBonus, levelBonus } = SIMILAR_PROGRAMS
const EXPLANATION =
  `Сходство = ${decimal(1 - directionBonus - levelBonus)} × косинус векторов навыков + ${decimal(directionBonus)} ` +
  `за то же направление + ${decimal(levelBonus)} за тот же уровень. ` +
  'Вес навыка в векторе — важность в программе × idf (редкий навык весит больше общего). ' +
  'Программы без общих навыков не показываются. «Чего не хватает» — навыки похожих программ, ' +
  'которых нет у этой, по сумме «сходство × важность».'
