import { prisma } from '@/shared/db/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { CONTROL_STAGE_NUMBER } from '@/shared/config/workflow.config'
import { ACTIVE_COOPERATION_STATUSES, INBOUND_LETTER_OPEN_STATUSES } from '@/shared/contracts/enums'
import { OPEN_COOPERATION_STATUSES } from '@/modules/cooperation/cooperation.rules'
import { resolveTargetLabels, targetKey } from '@/modules/recommendations/recommendations.repo'
import { isLockedByControlPoint } from '@/modules/workflow/workflow.rules'
import { dueDateIso } from '@/modules/assignments/assignments.rules'
import type {
  AssignmentFeedSource,
  DocumentChangeSource,
  FeedSources,
  LetterFeedSource,
  RecommendationSource,
  ResponsibleAssignedSource,
  StageChangeSource,
  StageDeadlineSource,
} from './notifications.rules'
import type { AssignmentContext, AssignmentScope, AssignmentStageRef } from './notifications.assignment'

/** Номер этапа из данных рекомендации — у просрочки он там всегда есть. */
function stageNumberOf(relatedData: unknown): number | null {
  if (typeof relatedData !== 'object' || relatedData === null) return null
  const value = (relatedData as Record<string, unknown>).stageNumber
  return typeof value === 'number' ? value : null
}

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

/** Действия журнала, из которых лента узнаёт о назначении ответственным. */
const RESPONSIBLE_ACTIONS = ['university.responsible.set', 'cooperation.responsible.set', 'stage.responsible.set'] as const

type ResponsiblePayload = { responsibleId?: string | null; previousResponsibleId?: string | null } | null

const nameOf = (university: { name: string; shortName: string | null }): string => university.shortName ?? university.name

/**
 * Пользователя назначили или сняли ответственным — за вуз (решение 146, роль
 * «Руководитель»), за связку или за этап (решение 205). Читается из журнала действий
 * (`*.responsible.set`), отдельной таблицы нет — тот же приём, что у остальной ленты
 * (решение 139).
 *
 * Своё действие — не уведомление (как `notBy` у истории этапов): назначил себя сам —
 * знаешь и так. Запись, где ответственный не сменился (повторное сохранение того же),
 * — тоже не событие.
 */
async function loadResponsibleAssignments(userId: string, since: Date): Promise<ResponsibleAssignedSource[]> {
  const rows = await prisma.auditLog.findMany({
    where: {
      action: { in: [...RESPONSIBLE_ACTIONS] },
      createdAt: { gte: since },
      AND: [
        { OR: [{ userId: null }, { userId: { not: userId } }] },
        {
          OR: [
            { payload: { path: ['responsibleId'], equals: userId } },
            { payload: { path: ['previousResponsibleId'], equals: userId } },
          ],
        },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: PER_SOURCE,
    select: { id: true, action: true, objectId: true, payload: true, createdAt: true },
  })
  const changed = rows.filter((row) => {
    const payload = row.payload as ResponsiblePayload
    return payload !== null && (payload.responsibleId ?? null) !== (payload.previousResponsibleId ?? null)
  })
  if (changed.length === 0) return []

  const idsOf = (action: (typeof RESPONSIBLE_ACTIONS)[number]) =>
    [...new Set(changed.filter((row) => row.action === action).map((row) => row.objectId))]
  const whereSelect = { university: { select: { name: true, shortName: true } }, program: { select: { name: true } } }

  const [universities, cooperations, stages] = await Promise.all([
    prisma.university.findMany({
      where: { id: { in: idsOf('university.responsible.set') } },
      select: { id: true, name: true, shortName: true },
    }),
    prisma.cooperation.findMany({
      where: { id: { in: idsOf('cooperation.responsible.set') } },
      select: { id: true, ...whereSelect },
    }),
    prisma.workflowStage.findMany({
      where: { id: { in: idsOf('stage.responsible.set') } },
      select: { id: true, stageNumber: true, title: true, cooperationId: true, cooperation: { select: whereSelect } },
    }),
  ])
  const universityById = new Map(universities.map((u) => [u.id, u]))
  const cooperationById = new Map(cooperations.map((c) => [c.id, c]))
  const stageById = new Map(stages.map((st) => [st.id, st]))

  return changed.flatMap((row): ResponsibleAssignedSource[] => {
    // Снял пользователя и в этом же действии назначил его же обратно — «назначен» важнее.
    const assigned = (row.payload as ResponsiblePayload)?.responsibleId === userId
    const base = { auditLogId: row.id, assigned, changedAt: row.createdAt }
    switch (row.action) {
      case 'university.responsible.set': {
        const university = universityById.get(row.objectId)
        return university
          ? [{ ...base, scope: 'university', universityId: row.objectId, universityName: nameOf(university) }]
          : []
      }
      case 'cooperation.responsible.set': {
        const cooperation = cooperationById.get(row.objectId)
        return cooperation
          ? [
              {
                ...base,
                scope: 'cooperation',
                cooperationId: row.objectId,
                universityName: nameOf(cooperation.university),
                programName: cooperation.program.name,
              },
            ]
          : []
      }
      case 'stage.responsible.set': {
        const stage = stageById.get(row.objectId)
        return stage
          ? [
              {
                ...base,
                scope: 'stage',
                cooperationId: stage.cooperationId,
                stageId: stage.id,
                stageNumber: stage.stageNumber,
                stageTitle: stage.title,
                universityName: nameOf(stage.cooperation.university),
                programName: stage.cooperation.program.name,
              },
            ]
          : []
      }
      default:
        return []
    }
  })
}

const assignmentStageSelect = {
  id: true,
  stageNumber: true,
  title: true,
  status: true,
  deadline: true,
} satisfies Prisma.WorkflowStageSelect

function toAssignmentStage(row: Prisma.WorkflowStageGetPayload<{ select: typeof assignmentStageSelect }>): AssignmentStageRef {
  return { stageId: row.id, stageNumber: row.stageNumber, title: row.title, status: row.status, deadline: row.deadline }
}

/**
 * Что написать новому ответственному (решение 205): названия, этап и срок — без
 * персональных данных. `null` — объекта уже нет (удалён между записью и отправкой).
 */
export async function loadAssignmentContext(scope: AssignmentScope, id: string): Promise<AssignmentContext | null> {
  const whereSelect = { university: { select: { name: true, shortName: true } }, program: { select: { name: true } } }
  switch (scope) {
    case 'cooperation': {
      const row = await prisma.cooperation.findUnique({
        where: { id },
        select: { id: true, ...whereSelect, stages: { select: assignmentStageSelect } },
      })
      return row
        ? {
            scope,
            cooperationId: row.id,
            universityName: nameOf(row.university),
            programName: row.program.name,
            stages: row.stages.map(toAssignmentStage),
          }
        : null
    }
    case 'stage': {
      const row = await prisma.workflowStage.findUnique({
        where: { id },
        select: { ...assignmentStageSelect, cooperationId: true, cooperation: { select: whereSelect } },
      })
      return row
        ? {
            scope,
            cooperationId: row.cooperationId,
            universityName: nameOf(row.cooperation.university),
            programName: row.cooperation.program.name,
            stage: toAssignmentStage(row),
          }
        : null
    }
    case 'university': {
      const row = await prisma.university.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          shortName: true,
          // «В работе» — как «Активные связи» в шапке главной: черновики и действующие, без паузы.
          _count: { select: { cooperations: { where: { status: { in: [...ACTIVE_COOPERATION_STATUSES] } } } } },
        },
      })
      return row
        ? { scope, universityId: row.id, universityName: nameOf(row), activeCooperations: row._count.cooperations }
        : null
    }
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
  const [deadlines, stageChanges, documentChanges, recommendations, responsibleAssignments, assignments] = await Promise.all([
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
          select: {
            university: { select: { name: true, shortName: true } },
            program: { select: { name: true } },
            // Этапы связки — чтобы узнать, не заперт ли этап контрольной точкой.
            stages: { select: { stageNumber: true, title: true, status: true } },
          },
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
        ruleKey: true,
        relatedData: true,
        title: true,
        objectType: true,
        objectId: true,
        priority: true,
        createdAt: true,
        cooperationId: true,
      },
    }),
    loadResponsibleAssignments(userId, since),
    loadAssignments(userId),
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
              lockedByControlPoint: isLockedByControlPoint(row, row.cooperation.stages),
            },
          ]
        : [],
    ),
    stageChanges: stageChanges.map(toStageChange),
    documentChanges: documentChanges.map(toDocumentChange),
    recommendations: recommendations.map(
      (row): RecommendationSource => ({
        id: row.id,
        ruleKey: row.ruleKey,
        stageNumber: stageNumberOf(row.relatedData),
        title: row.title,
        label: labels.get(targetKey(row.objectType, row.objectId)) ?? row.title,
        priority: row.priority,
        createdAt: row.createdAt,
        cooperationId: row.cooperationId,
      }),
    ),
    responsibleAssignments,
    assignments,
  }
}

/**
 * Открытые поручения пользователю (решение 207): по ним лента строит «Вам поручение»,
 * «срок завтра» и «срок прошёл». Сделанные не нужны — о них напоминать нечего.
 * Ближайший срок первым: при обрезке остаются самые срочные.
 */
async function loadAssignments(userId: string): Promise<AssignmentFeedSource[]> {
  const rows = await prisma.assignment.findMany({
    where: { assigneeId: userId, status: { in: ['NEW', 'IN_PROGRESS'] } },
    orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
    take: PER_SOURCE,
    select: {
      id: true,
      text: true,
      status: true,
      priority: true,
      dueAt: true,
      authorId: true,
      cooperationId: true,
      createdAt: true,
      university: { select: { name: true, shortName: true } },
      cooperation: { select: { university: { select: { name: true, shortName: true } } } },
    },
  })
  return rows.map((row) => {
    const university = row.university ?? row.cooperation?.university ?? null
    return {
      id: row.id,
      text: row.text,
      status: row.status,
      priority: row.priority,
      dueDate: dueDateIso(row.dueAt),
      universityName: university ? (university.shortName ?? university.name) : null,
      cooperationId: row.cooperationId,
      fromSomeoneElse: row.authorId !== userId,
      createdAt: row.createdAt,
    }
  })
}

/**
 * Лента представителя вуза: движение по связкам и документам его вуза.
 * Сроков, рекомендаций и аналитики здесь нет — это внутренняя кухня ИТ-Школы,
 * и в кабинете вуза её нет тоже. Документы — по тому же правилу
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
    // Ответственный назначается только сотруднику (assertStaffResponsible, RESPONSIBLE_ROLES):
    // представитель вуза им не бывает, событию в его ленте взяться неоткуда.
    responsibleAssignments: [],
    // Поручения даются только сотрудникам ИТ-Школы (assignments.repo.findAssignableUser).
    assignments: [],
  }
}

/**
 * Время последнего просмотра ленты уведомлений — источник истины на сервере
 * (решение 139). `null`, если пользователь ещё ни разу не отмечал ленту просмотренной.
 */
export async function getSeenAt(userId: string): Promise<Date | null> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { notificationsSeenAt: true },
  })
  return row?.notificationsSeenAt ?? null
}

/** Ставит время последнего просмотра ленты. */
export async function setSeenAt(userId: string, seenAt: Date): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { notificationsSeenAt: seenAt },
  })
}

/**
 * Сколько непроверенных писем показывать в ленте: остальное — в «Письмах вузов».
 * Немного — лента общая, письма не должны вытеснять сроки и поручения.
 */
const LETTERS_IN_FEED = 5

/**
 * Непроверенные письма вузов за окно ленты (решение 213) — для тех, кто их разбирает.
 * Кто принял письмо в работу — по журналу (`inbound_letter.accept`), как в карточке письма.
 */
export async function loadNewLetters(userId: string, since: Date): Promise<LetterFeedSource[]> {
  const letters = await prisma.inboundLetter.findMany({
    where: { status: { in: [...INBOUND_LETTER_OPEN_STATUSES] }, createdAt: { gte: since } },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: LETTERS_IN_FEED,
    select: {
      id: true,
      group: true,
      detectedGroup: true,
      createdAt: true,
      university: { select: { name: true, shortName: true } },
    },
  })
  if (letters.length === 0) return []

  const accepts = await prisma.auditLog.findMany({
    where: {
      action: 'inbound_letter.accept',
      objectType: 'InboundLetter',
      objectId: { in: letters.map((letter) => letter.id) },
      userId: { not: null },
    },
    orderBy: { createdAt: 'asc' },
    select: { objectId: true, userId: true, user: { select: { fullName: true } } },
  })
  const mine = new Set(accepts.filter((row) => row.userId === userId).map((row) => row.objectId))
  const firstOther = new Map<string, string | null>()
  for (const row of accepts) {
    if (row.userId !== userId && !firstOther.has(row.objectId)) firstOther.set(row.objectId, row.user?.fullName ?? null)
  }

  return letters.map((letter) => ({
    id: letter.id,
    group: letter.group ?? letter.detectedGroup,
    universityName: letter.university ? letter.university.shortName ?? letter.university.name : null,
    createdAt: letter.createdAt,
    acceptedByMe: mine.has(letter.id),
    // Приняли, но имя не известно (сотрудник удалён из справочника) — всё равно «принято».
    acceptedByName: firstOther.has(letter.id) ? firstOther.get(letter.id) ?? 'сотрудник' : null,
  }))
}
