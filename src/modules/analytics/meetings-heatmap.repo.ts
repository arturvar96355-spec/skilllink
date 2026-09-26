import { prisma } from '@/shared/db/prisma'
import { universityLinkedWhere } from '@/shared/db/university-scope'

/** Даты проведённых встреч (не позже `to`) в пределах видимости и фильтра по вузу. */
export async function findHeldMeetings(
  filter: { universityId?: string },
  from: Date | null,
  to: Date,
): Promise<Array<{ date: Date; isMock: boolean }>> {
  const rows = await prisma.meeting.findMany({
    where: {
      AND: [universityLinkedWhere(filter), { date: { lte: to, ...(from ? { gte: from } : {}) } }],
    },
    select: { date: true, cooperation: { select: { isMock: true } }, university: { select: { isMock: true } } },
  })
  return rows.map((row) => ({ date: row.date, isMock: (row.cooperation?.isMock ?? false) || (row.university?.isMock ?? false) }))
}
