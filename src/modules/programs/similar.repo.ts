import { prisma } from '@/shared/db/prisma'
import type { ProgramForSimilarity } from './similar.rules'

/**
 * Программы с навыками для похожих программ (решение 134): действующие (не в архиве)
 * и сама программа, даже если она в архиве, — для неё тоже можно найти похожие.
 */
export async function loadProgramsForSimilarity(programId: string): Promise<ProgramForSimilarity[]> {
  const rows = await prisma.educationalProgram.findMany({
    where: { OR: [{ archivedAt: null }, { id: programId }] },
    select: {
      id: true,
      name: true,
      universityId: true,
      level: true,
      code: true,
      direction: true,
      university: { select: { name: true } },
      skills: { select: { skillId: true, importance: true, skill: { select: { name: true } } } },
    },
  })
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    universityId: row.universityId,
    universityName: row.university.name,
    level: row.level,
    code: row.code,
    direction: row.direction,
    skills: row.skills.map((skill) => ({ skillId: skill.skillId, skillName: skill.skill.name, importance: skill.importance })),
  }))
}
