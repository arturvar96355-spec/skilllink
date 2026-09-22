import { prisma } from '@/shared/db/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { CONTROL_STAGE_NUMBER } from '@/shared/config/workflow.config'
import { OPEN_COOPERATION_STATUSES } from '@/modules/cooperation/cooperation.rules'
import { resolveTargetLabels, targetKey } from '@/modules/recommendations/recommendations.repo'
import type {
  DocumentChangeSource,
  FeedSources,
  RecommendationSource,
  StageChangeSource,
  StageDeadlineSource,
} from './notifications.rules'

/** Больше этого из одного источника ленте не нужно: она всё равно короче. */
const PER_SOURCE = 50

/**
 * «Сделано не мной»: о собственных действиях уведомлять незачем. Автор у записи
 * истории обязателен — схема не допускает изменения без автора.
 */
function notBy(userId: string) {
  return { changedById: { not: userId } }
}

const stageChangeSelect = {
  id: true,
  toStatus: true,
  changedAt: true,
  changedBy: { select: { fullName: true } },
  stage: {
    select: {
      id: true,
      stageNumber: true,
      title: true,
      cooperationId: true,
      cooperation: {
        select: { university: { select: { name: true, shortName: true } }, program: { select: { name: true } } },
      },
    },
  },
} satisfies Prisma.StageHistorySelect

type StageChangeRow = Prisma.StageHistoryGetPayload<{ select: typeof stageChangeSelect }>

function toStageChange(row: StageChangeRow): StageChangeSource {
  return {
    historyId: row.id,
    stageId: row.stage.id,
    stageNumber: row.stage.stageNumber,
    stageTitle: row.stage.title,
    toStatus: row.toStatus,
    changedAt: row.changedAt,
    cooperationId: row.stage.cooperationId,
    universityName: row.stage.cooperation.university.shortName ?? row.stage.cooperation.university.name,
    programName: row.stage.cooperation.program.name,
    authorName: row.changedBy?.fullName ?? null,
  }
}

const documentChangeSelect = {
  id: true,
  toStatus: true,
  changedAt: true,
  document: {
    select: {
      id: true,
      title: true,
      version: true,
      cooperationId: true,
      university: { select: { name: true, shortName: true } },
      cooperation: { select: { university: { select: { name: true, shortName: true } } } },
      program: { select: { university: { select: { name: true, shortName: true } } } },
    },
  },
} satisfies Prisma.DocumentHistorySelect

type DocumentChangeRow = Prisma.DocumentHistoryGetPayload<{ select: typeof documentChangeSelect }>

function toDocumentChange(row: DocumentChangeRow): DocumentChangeSource {
  const document = row.document
  return {
    historyId: row.id,
    documentId: document.id,
    title: document.title,
    version: document.version,
    toStatus: row.toStatus,
    changedAt: row.changedAt,
    cooperationId: document.cooperationId,
    universityName: (() => {
      const university =
        document.university ?? document.cooperation?.university ?? document.program?.university ?? null
      return university ? (university.shortName ?? university.name) : null
    })(),
  }
}

/**
 * Лента сотрудника: его этапы со сроками, изменения других людей в его связках
 * и документах, важные открытые рекомендации по его связкам. Общие рекомендации,
 * не привязанные к связке, — только тем, кому открыта аналитика.
 */
export async function loadForStaff(
  userId: string,
  since: Date,
  includeGlobalRecommendations: boolean,
): Promise<FeedSources> {
  const [deadlines, stageChanges, documentChanges, recommendations] = await Promise.all([
    prisma.workflowStage.findMany({
      where: {
        responsibleId: userId,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
        deadline: { not: null },
        // Контрольный этап руками не меняется — напоминать о нём бессмысленно.
        stageNumber: { not: CONTROL_STAGE_NUMBER },
        cooperation: { status: { in: [...OPEN_COOPERATION_STATUSES] } },
      },
      orderBy: { deadline: 'asc' },
      take: PER_SOURCE,
      select: {
        id: true,
        stageNumber: true,
        title: true,
        status: true,
        deadline: true,
        cooperationId: true,
        cooperation: {
          select: { university: { select: { name: true, shortName: true } }, program: { select: { name: true } } },
        },
      },
    }),
    prisma.stageHistory.findMany({
      where: {
        changedAt: { gte: since },
        stage: { cooperation: { responsibleId: userId } },
        ...notBy(userId),
      },
      orderBy: { changedAt: 'desc' },
      take: PER_SOURCE,
      select: stageChangeSelect,
    }),
    prisma.documentHistory.findMany({
      where: {
        changedAt: { gte: since },
        document: { OR: [{ responsibleId: userId }, { cooperation: { responsibleId: userId } }] },
        ...notBy(userId),
      },
      orderBy: { changedAt: 'desc' },
      take: PER_SOURCE,
      select: documentChangeSelect,
    }),
    prisma.recommendation.findMany({
      where: {
        status: { in: ['NEW', 'IN_PROGRESS'] },
        priority: { in: ['HIGH', 'CRITICAL'] },
        OR: [
          { cooperation: { responsibleId: userId } },
          ...(includeGlobalRecommendations ? [{ cooperationId: null }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: PER_SOURCE,
      select: {
        id: true,
        title: true,
        objectType: true,
        objectId: true,
        priority: true,
        createdAt: true,
        cooperationId: true,
      },
    }),
  ])

  const labels = await resolveTargetLabels(recommendations)

  return {
    deadlines: deadlines.flatMap((row): StageDeadlineSource[] =>
      row.deadline
        ? [
            {
              stageId: row.id,
              stageNumber: row.stageNumber,
              stageTitle: row.title,
              status: row.status,
              deadline: row.deadline,
              cooperationId: row.cooperationId,
              universityName: row.cooperation.university.shortName ?? row.cooperation.university.name,
              programName: row.cooperation.program.name,
            },
          ]
        : [],
    ),
    stageChanges: stageChanges.map(toStageChange),
    documentChanges: documentChanges.map(toDocumentChange),
    recommendations: recommendations.map(
      (row): RecommendationSource => ({
        id: row.id,
        title: row.title,
        label: labels.get(targetKey(row.objectType, row.objectId)) ?? row.title,
        priority: row.priority,
        createdAt: row.createdAt,
        cooperationId: row.cooperationId,
      }),
    ),
  }
}

/**
 * Лента представителя вуза: движение по связкам и документам его вуза.
 * Сроков, рекомендаций и аналитики здесь нет — это внутренняя кухня ИТ-Школы,
 * и в кабинете вуза её нет тоже (решение 9). Документы — по тому же правилу
 * видимости, что и список документов представителя.
 */
export async function loadForUniversity(
  universityId: string,
  userId: string,
  since: Date,
): Promise<FeedSources> {
  const [stageChanges, documentChanges] = await Promise.all([
    prisma.stageHistory.findMany({
      where: {
        changedAt: { gte: since },
        stage: { cooperation: { universityId } },
        ...notBy(userId),
      },
      orderBy: { changedAt: 'desc' },
      take: PER_SOURCE,
      select: stageChangeSelect,
    }),
    prisma.documentHistory.findMany({
      where: {
        changedAt: { gte: since },
        document: {
          OR: [
            { universityId },
            { cooperation: { universityId } },
            { program: { universityId } },
          ],
        },
        ...notBy(userId),
      },
      orderBy: { changedAt: 'desc' },
      take: PER_SOURCE,
      select: documentChangeSelect,
    }),
  ])

  return {
    deadlines: [],
    stageChanges: stageChanges.map(toStageChange),
    documentChanges: documentChanges.map(toDocumentChange),
    recommendations: [],
  }
}
