import { prisma } from '@/shared/db/prisma'
import { TIE_BREAKER } from '@/shared/http/pagination'
import { OPEN_COOPERATION_STATUSES } from '@/modules/cooperation/cooperation.rules'
import { problemStageWhere } from '@/modules/analytics/analytics.repo'
import {
  recommendationSelect,
  type RecommendationRow,
} from '@/modules/recommendations/recommendations.repo'
import { OPEN_RECOMMENDATION_STATUSES } from '@/modules/recommendations/recommendations.rules'
import type { KnownPeople } from './ai-assist.privacy'
import type { ProblemStageInput, ProgramLabel } from './ai-assist.rules'

/**
 * Что нужно, чтобы вычистить персональные данные перед отправкой в модель.
 *
 * `people` — ФИО. Сотрудники — все: их немного, а в причине блокировки может
 * оказаться любой. Контактные лица и представители — только названных вузов:
 * у крупного заказчика контактов тысячи, а в тексте про связку бывают только
 * люди её вуза.
 *
 * `universityNames` — официальные названия всех вузов. Их не трогают: в названии
 * бывают инициалы («имени М. А. Бонч-Бруевича»), и без защиты правило
 * «И. О. Фамилия» вырезало бы кусок названия из текста рекомендации.
 */
export async function findRedactionContext(
  universityIds: readonly string[],
): Promise<{ people: KnownPeople; universityNames: string[] }> {
  const ids = [...new Set(universityIds)]
  const [users, contacts, universities] = await Promise.all([
    prisma.user.findMany({ select: { fullName: true, role: true } }),
    ids.length === 0
      ? Promise.resolve([])
      : prisma.contact.findMany({
          where: { universityId: { in: ids } },
          select: { fullName: true },
        }),
    prisma.university.findMany({ select: { name: true, shortName: true } }),
  ])
  return {
    people: {
      staff: users.filter((user) => user.role !== 'UNIVERSITY_REP').map((user) => user.fullName),
      contacts: [
        ...users.filter((user) => user.role === 'UNIVERSITY_REP').map((user) => user.fullName),
        ...contacts.map((contact) => contact.fullName),
      ],
    },
    universityNames: universities.flatMap((university) =>
      university.shortName ? [university.name, university.shortName] : [university.name],
    ),
  }
}

/** Программа для письма о недостающих показателях: только названия. */
export async function findProgramLabel(id: string): Promise<(ProgramLabel & { universityId: string }) | null> {
  const row = await prisma.educationalProgram.findUnique({
    where: { id },
    select: { name: true, universityId: true, university: { select: { name: true, shortName: true } } },
  })
  if (!row) return null
  return {
    name: row.name,
    universityId: row.universityId,
    universityName: row.university.name,
    universityShortName: row.university.shortName,
  }
}

/** Порядок ленты: важность, затем новые — как в `findPriorityRecommendations`. */
const FEED_ORDER = [{ priority: 'desc' as const }, { createdAt: 'desc' as const }, TIE_BREAKER]

/** Открытые рекомендации по открытым связкам, где пользователь — ответственный. */
export async function findOpenRecommendationsOf(userId: string, limit: number): Promise<RecommendationRow[]> {
  return prisma.recommendation.findMany({
    where: {
      status: { in: [...OPEN_RECOMMENDATION_STATUSES] },
      cooperation: { responsibleId: userId, status: { in: [...OPEN_COOPERATION_STATUSES] } },
    },
    orderBy: FEED_ORDER,
    take: limit,
    select: recommendationSelect,
  })
}

/**
 * Общие открытые рекомендации — добор списка «на сегодня».
 *
 * У пользователя со своими связками — только не привязанные к связке (дефицит
 * навыка, показатели программы): чужие связки — не его дела. У того, у кого своих
 * связок нет (аналитик, администратор), — вся лента по порядку.
 */
export async function findGeneralRecommendations(
  userId: string,
  limit: number,
): Promise<RecommendationRow[]> {
  const ownCooperations = await prisma.cooperation.count({ where: { responsibleId: userId } })
  return prisma.recommendation.findMany({
    where: {
      status: { in: [...OPEN_RECOMMENDATION_STATUSES] },
      ...(ownCooperations > 0 ? { cooperationId: null } : {}),
    },
    orderBy: FEED_ORDER,
    take: limit,
    select: recommendationSelect,
  })
}

/**
 * Проблемные этапы связок пользователя — по тому же условию, что на главной
 * (`problemStageWhere`): срок вышел или этап заблокирован, связка открыта.
 * «Его» — ответственный за этап или за связку.
 */
export async function findProblemStagesOf(
  userId: string,
  now: Date,
  limit: number,
): Promise<ProblemStageInput[]> {
  const rows = await prisma.workflowStage.findMany({
    where: {
      AND: [
        problemStageWhere({}, now),
        { OR: [{ responsibleId: userId }, { cooperation: { responsibleId: userId } }] },
      ],
    },
    select: {
      stageNumber: true,
      title: true,
      status: true,
      deadline: true,
      blockingReason: true,
      cooperation: {
        select: {
          id: true,
          universityId: true,
          university: { select: { name: true, shortName: true } },
          program: { select: { name: true } },
          stages: { select: { stageNumber: true, title: true, status: true } },
        },
      },
    },
    orderBy: [{ deadline: 'asc' }, TIE_BREAKER],
    take: limit,
  })

  return rows.map((row) => ({
    cooperationId: row.cooperation.id,
    universityId: row.cooperation.universityId,
    universityName: row.cooperation.university.name,
    universityShortName: row.cooperation.university.shortName,
    programName: row.cooperation.program.name,
    stageNumber: row.stageNumber,
    title: row.title,
    status: row.status,
    deadline: row.deadline,
    blockingReason: row.blockingReason,
    siblings: row.cooperation.stages,
  }))
}
