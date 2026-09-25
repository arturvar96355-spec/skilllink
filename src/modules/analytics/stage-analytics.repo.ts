import { prisma } from '@/shared/db/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { OPEN_COOPERATION_STATUSES } from '@/modules/cooperation/cooperation.rules'
import { CONTROL_STAGE_NUMBER } from '@/shared/config/workflow.config'

/**
 * Доступ к базе для аналитики этапов (решение 120): хронологии, ряды «Система
 * заметила», источники пульса. Только чтение.
 *
 * `scope` — фильтр представителя вуза (`universityScope`). Аналитика ему закрыта
 * правом ANALYTICS, но фильтр накладывается и здесь: право — одна стена, область
 * видимости — вторая (решение 10).
 */

type Scope = { universityId?: string }

const timelineSelect = {
  id: true,
  status: true,
  startedAt: true,
  createdAt: true,
  closedAt: true,
  updatedAt: true,
  isMock: true,
  university: { select: { id: true, name: true, shortName: true, region: true, city: true } },
  program: { select: { id: true, name: true, level: true } },
  product: { select: { id: true, name: true } },
  stages: {
    where: { stageNumber: { lt: CONTROL_STAGE_NUMBER } },
    select: {
      stageNumber: true,
      status: true,
      completedAt: true,
      history: { select: { toStatus: true, changedAt: true }, orderBy: { changedAt: 'asc' } },
    },
  },
} satisfies Prisma.CooperationSelect

export type TimelineRow = Prisma.CooperationGetPayload<{ select: typeof timelineSelect }>

/**
 * Связки с историей этапов — вход хронологий. Черновики не берутся: работа
 * по ним не начата, и их «время на этапе 1» — время до решения начинать.
 */
export async function findTimelineRows(scope: Scope): Promise<TimelineRow[]> {
  return prisma.cooperation.findMany({
    where: { ...scope, status: { not: 'DRAFT' } },
    select: timelineSelect,
    orderBy: { id: 'asc' },
  })
}

/**
 * Открытые связки для предпросмотра порога застоя — те же поля, что берёт правило
 * рекомендаций (`CooperationRuleInput`): последнее движение по этапам и чек-листу.
 */
const stalledCandidateSelect = {
  id: true,
  isMock: true,
  productId: true,
  updatedAt: true,
  university: { select: { id: true, name: true, shortName: true } },
  program: { select: { id: true, name: true } },
  stages: {
    orderBy: { stageNumber: 'asc' },
    select: {
      stageNumber: true,
      title: true,
      status: true,
      deadline: true,
      responsible: { select: { fullName: true } },
      history: { select: { changedAt: true }, orderBy: { changedAt: 'desc' }, take: 1 },
      tasks: {
        where: { doneAt: { not: null } },
        select: { doneAt: true },
        orderBy: { doneAt: 'desc' },
        take: 1,
      },
    },
  },
} satisfies Prisma.CooperationSelect

export type StalledCandidateRow = Prisma.CooperationGetPayload<{ select: typeof stalledCandidateSelect }>

export async function findStalledCandidates(
  scope: Scope,
  options: { responsibleId?: string } = {},
): Promise<StalledCandidateRow[]> {
  return prisma.cooperation.findMany({
    where: {
      ...scope,
      status: { in: [...OPEN_COOPERATION_STATUSES] },
      ...(options.responsibleId
        ? {
            OR: [
              { responsibleId: options.responsibleId },
              { stages: { some: { responsibleId: options.responsibleId } } },
            ],
          }
        : {}),
    },
    select: stalledCandidateSelect,
    orderBy: { id: 'asc' },
  })
}

// ─────────────────────────── Ряды «Система заметила» ────────────────────────

export interface SeriesEvent {
  at: Date
  universityId: string | null
}

export interface SeriesSource {
  /** Заведение связок (дата начала работы, иначе создания). */
  newCooperations: SeriesEvent[]
  /** Закрытые этапы 1–13 (запись истории «→ COMPLETED»). */
  stageTransitions: SeriesEvent[]
  /** Проведённые встречи — по дате встречи, не позже «сейчас». */
  meetings: SeriesEvent[]
  /** Отклонённые рекомендации — по дате решения. */
  dismissedRecommendations: SeriesEvent[]
  /** Связки для «активных вузов» в окне: вуз, начало, закрытие. */
  cooperationSpans: Array<{ universityId: string; start: Date; closedAt: Date | null; status: string }>
  universities: Array<{ id: string; name: string; shortName: string | null }>
}

export async function loadSeriesSource(scope: Scope, since: Date, now: Date): Promise<SeriesSource> {
  const cooperationWhere: Prisma.CooperationWhereInput = { ...scope }
  const [cooperations, transitions, meetings, dismissed, universities] = await Promise.all([
    prisma.cooperation.findMany({
      where: cooperationWhere,
      select: { universityId: true, startedAt: true, createdAt: true, closedAt: true, status: true },
    }),
    prisma.stageHistory.findMany({
      where: {
        toStatus: 'COMPLETED',
        changedAt: { gte: since, lte: now },
        stage: { stageNumber: { lt: CONTROL_STAGE_NUMBER }, cooperation: cooperationWhere },
      },
      select: { changedAt: true, stage: { select: { cooperation: { select: { universityId: true } } } } },
    }),
    prisma.meeting.findMany({
      where: {
        date: { gte: since, lte: now },
        ...(scope.universityId
          ? {
              OR: [
                { universityId: scope.universityId },
                { cooperation: { universityId: scope.universityId } },
                { program: { universityId: scope.universityId } },
              ],
            }
          : {}),
      },
      select: {
        date: true,
        universityId: true,
        cooperation: { select: { universityId: true } },
        program: { select: { universityId: true } },
      },
    }),
    prisma.recommendation.findMany({
      where: {
        status: 'DISMISSED',
        resolvedAt: { gte: since, lte: now },
        ...(scope.universityId ? { cooperation: { universityId: scope.universityId } } : {}),
      },
      select: { resolvedAt: true, cooperation: { select: { universityId: true } } },
    }),
    prisma.university.findMany({
      where: scope.universityId ? { id: scope.universityId } : {},
      select: { id: true, name: true, shortName: true },
    }),
  ])

  return {
    newCooperations: cooperations
      .filter((row) => row.status !== 'DRAFT')
      .map((row) => ({ at: row.startedAt ?? row.createdAt, universityId: row.universityId })),
    stageTransitions: transitions.map((row) => ({
      at: row.changedAt,
      universityId: row.stage.cooperation.universityId,
    })),
    meetings: meetings.map((row) => ({
      at: row.date,
      universityId: row.universityId ?? row.cooperation?.universityId ?? row.program?.universityId ?? null,
    })),
    dismissedRecommendations: dismissed.map((row) => ({
      at: row.resolvedAt!,
      universityId: row.cooperation?.universityId ?? null,
    })),
    cooperationSpans: cooperations
      .filter((row) => row.status !== 'DRAFT')
      .map((row) => ({
        universityId: row.universityId,
        start: row.startedAt ?? row.createdAt,
        closedAt: row.closedAt,
        status: row.status,
      })),
    universities,
  }
}

/** Самое раннее событие в данных — начало истории рядов. */
export async function findHistoryStart(scope: Scope): Promise<Date | null> {
  const [cooperation, history] = await Promise.all([
    prisma.cooperation.aggregate({ where: { ...scope, status: { not: 'DRAFT' } }, _min: { createdAt: true, startedAt: true } }),
    prisma.stageHistory.aggregate({
      where: scope.universityId ? { stage: { cooperation: { universityId: scope.universityId } } } : {},
      _min: { changedAt: true },
    }),
  ])
  const candidates = [cooperation._min.createdAt, cooperation._min.startedAt, history._min.changedAt].filter(
    (value): value is Date => value instanceof Date,
  )
  if (candidates.length === 0) return null
  return new Date(Math.min(...candidates.map((value) => value.getTime())))
}

// ─────────────────────────────── Пульс ──────────────────────────────────────

/** Встречи пользователя: он ответственный, участник или ведёт связку встречи. */
function myMeetingsWhere(userId: string): Prisma.MeetingWhereInput {
  return {
    OR: [
      { responsibleId: userId },
      { participants: { some: { userId } } },
      { cooperation: { responsibleId: userId } },
    ],
  }
}

const pulseMeetingSelect = {
  id: true,
  date: true,
  topic: true,
  result: true,
  nextAction: true,
  nextActionDueAt: true,
  cooperationId: true,
  university: { select: { name: true, shortName: true } },
  cooperation: {
    select: { university: { select: { name: true, shortName: true } }, program: { select: { name: true } } },
  },
} satisfies Prisma.MeetingSelect

export type PulseMeetingRow = Prisma.MeetingGetPayload<{ select: typeof pulseMeetingSelect }>

/** Встречи без итога в окне «прошли» и встречи/следующие действия на сегодня. */
export async function findPulseMeetings(
  userId: string,
  window: { pastFrom: Date; pastTo: Date; dayFrom: Date; dayTo: Date },
): Promise<{ withoutResult: PulseMeetingRow[]; today: PulseMeetingRow[]; actionsToday: PulseMeetingRow[] }> {
  const mine = myMeetingsWhere(userId)
  const [withoutResult, today, actionsToday] = await Promise.all([
    prisma.meeting.findMany({
      where: {
        AND: [mine, { date: { gte: window.pastFrom, lt: window.pastTo } }, { OR: [{ result: null }, { result: '' }] }],
      },
      select: pulseMeetingSelect,
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      take: 50,
    }),
    prisma.meeting.findMany({
      where: { AND: [mine, { date: { gte: window.dayFrom, lt: window.dayTo } }] },
      select: pulseMeetingSelect,
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      take: 50,
    }),
    prisma.meeting.findMany({
      where: { AND: [mine, { nextActionDueAt: { gte: window.dayFrom, lt: window.dayTo } }] },
      select: pulseMeetingSelect,
      orderBy: [{ nextActionDueAt: 'asc' }, { id: 'asc' }],
      take: 50,
    }),
  ])
  return { withoutResult, today, actionsToday }
}

/** Закрытые за окно этапы по связкам пользователя — раздел «Успехи». */
export async function findRecentCompletions(userId: string, since: Date, now: Date) {
  return prisma.stageHistory.findMany({
    where: {
      toStatus: 'COMPLETED',
      changedAt: { gte: since, lte: now },
      stage: {
        stageNumber: { lt: CONTROL_STAGE_NUMBER },
        OR: [{ responsibleId: userId }, { cooperation: { responsibleId: userId } }],
      },
    },
    select: {
      id: true,
      changedAt: true,
      stage: {
        select: {
          id: true,
          stageNumber: true,
          title: true,
          cooperation: {
            select: {
              id: true,
              university: { select: { name: true, shortName: true } },
              program: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: [{ changedAt: 'desc' }, { id: 'asc' }],
    take: 50,
  })
}
