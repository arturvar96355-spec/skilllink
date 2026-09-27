import { prisma } from '@/shared/db/prisma'
import { ACTIVE_COOPERATION_STATUSES, OPEN_COOPERATION_STATUSES } from '@/shared/contracts/enums'
import { CONTROL_STAGE_NUMBER } from '@/shared/config/workflow.config'
import { TEAM_IGNORED_ACTION_PREFIXES } from '@/shared/config/team.config'
import { TIE_BREAKER } from '@/shared/http/pagination'
import { ON_TIME_CANDIDATES, overdueStageWhere } from './analytics.repo'

/**
 * Выборки экрана «Команда» (решение 203).
 *
 * Каждая функция — один запрос сразу на всех сотрудников списка (`userIds`), а не по
 * запросу на человека: число запросов сводки не зависит от размера команды (это
 * проверяет тест `team.service.test.ts`). Условия подсчёта — те же, что у главной и
 * личного кабинета (`ON_TIME_CANDIDATES`, `overdueStageWhere`, статусы связок в работе):
 * иначе «36 связок» в команде и «Активные связи» на главной разошлись бы.
 */

/** Этапы, которые ещё ждут работы: у них бывает «ближайший срок» и «срок на неделе». */
const OPEN_STAGE_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED'] as const

/** Сотрудники ИТ-Школы в команде: действующие, не представители вуза и не учётки экспертов. */
const TEAM_USER_WHERE = {
  isActive: true,
  isReviewer: false,
  role: { not: 'UNIVERSITY_REP' as const },
}

const IGNORED_ACTIONS_WHERE = {
  NOT: TEAM_IGNORED_ACTION_PREFIXES.map((prefix) => ({ action: { startsWith: prefix } })),
}

export async function findTeamUsers(userId?: string) {
  return prisma.user.findMany({
    where: { ...TEAM_USER_WHERE, ...(userId ? { id: userId } : {}) },
    select: { id: true, fullName: true, position: true, role: true },
    orderBy: [{ fullName: 'asc' }, TIE_BREAKER],
  })
}

/**
 * Связки в работе — все, а не только команды: сумма по строкам плюс «вне команды»
 * обязана давать ровно «Активные связи» главной (`countCooperationsByStatus().active`).
 */
export async function findActiveCooperations(userIds: readonly string[] | null) {
  return prisma.cooperation.findMany({
    where: {
      status: { in: [...ACTIVE_COOPERATION_STATUSES] },
      ...(userIds ? { responsibleId: { in: [...userIds] } } : {}),
    },
    select: {
      responsibleId: true,
      universityId: true,
      isMock: true,
      university: { select: { name: true, shortName: true } },
    },
  })
}

/** Просроченные этапы по ответственному — то же условие, что в личном кабинете. */
export async function countOverdueByUser(userIds: readonly string[], now: Date) {
  const rows = await prisma.workflowStage.groupBy({
    by: ['responsibleId'],
    where: { responsibleId: { in: [...userIds] }, ...overdueStageWhere(now) },
    _count: { _all: true },
  })
  return new Map(rows.map((row) => [row.responsibleId as string, row._count._all]))
}

function upcomingStageWhere(now: Date) {
  return {
    deadline: { gte: now },
    status: { in: [...OPEN_STAGE_STATUSES] },
    stageNumber: { not: CONTROL_STAGE_NUMBER },
    cooperation: { status: { in: [...ACTIVE_COOPERATION_STATUSES] } },
  }
}

const STAGE_REF_SELECT = {
  id: true,
  stageNumber: true,
  title: true,
  status: true,
  deadline: true,
  responsibleId: true,
  cooperation: {
    select: {
      id: true,
      university: { select: { name: true, shortName: true } },
      program: { select: { name: true } },
    },
  },
} as const

/**
 * Ближайший срок каждого сотрудника — два запроса на всех: минимум срока по
 * ответственному (агрегат в базе), затем сами этапы с этими сроками.
 */
export async function findNearestDeadlines(userIds: readonly string[], now: Date) {
  const minima = await prisma.workflowStage.groupBy({
    by: ['responsibleId'],
    where: { responsibleId: { in: [...userIds] }, ...upcomingStageWhere(now) },
    _min: { deadline: true },
  })
  const pairs = minima
    .filter((row) => row.responsibleId && row._min.deadline)
    .map((row) => ({ responsibleId: row.responsibleId as string, deadline: row._min.deadline as Date }))
  if (pairs.length === 0) return []
  return prisma.workflowStage.findMany({
    where: { OR: pairs, ...upcomingStageWhere(now) },
    select: STAGE_REF_SELECT,
    orderBy: [{ deadline: 'asc' }, { stageNumber: 'asc' }, TIE_BREAKER],
  })
}

/** Встречи недели, где сотрудник ответственный или участник — одним запросом на всех. */
export async function findWeekMeetings(userIds: readonly string[], week: { from: Date; to: Date }) {
  const ids = [...userIds]
  return prisma.meeting.findMany({
    where: {
      date: { gte: week.from, lt: week.to },
      OR: [{ responsibleId: { in: ids } }, { participants: { some: { userId: { in: ids } } } }],
    },
    select: {
      id: true,
      date: true,
      topic: true,
      format: true,
      responsibleId: true,
      cooperationId: true,
      participants: { where: { userId: { in: ids } }, select: { userId: true } },
      university: { select: { shortName: true, name: true } },
      cooperation: { select: { university: { select: { shortName: true, name: true } } } },
    },
    orderBy: [{ date: 'asc' }, TIE_BREAKER],
  })
}

/** Открытые задания по письмам вузов на сотруднике. */
export async function countOpenLetterTasksByUser(userIds: readonly string[]) {
  const rows = await prisma.inboundLetterTask.groupBy({
    by: ['responsibleId'],
    where: { responsibleId: { in: [...userIds] }, status: 'OPEN' },
    _count: { _all: true },
  })
  return new Map(rows.map((row) => [row.responsibleId as string, row._count._all]))
}

/**
 * Завершённые этапы со сроком — по ним доля «в срок». Без фильтра по людям это ровно
 * выборка главной (`findCompletedStagesWithDeadline({})`): итог команды и главной
 * считаются по одному множеству, а по людям раскладывается уже в памяти.
 */
export async function findCompletedStagesWithDeadline(userIds: readonly string[] | null) {
  return prisma.workflowStage.findMany({
    where: { ...ON_TIME_CANDIDATES, ...(userIds ? { responsibleId: { in: [...userIds] } } : {}) },
    select: { responsibleId: true, deadline: true, completedAt: true, cooperation: { select: { isMock: true } } },
  })
}

const ACTION_SELECT = { userId: true, action: true, objectType: true, objectId: true, createdAt: true } as const

/** Последняя запись журнала каждого сотрудника — агрегат в базе и сами записи, два запроса. */
export async function findLastActions(userIds: readonly string[]) {
  const latest = await prisma.auditLog.groupBy({
    by: ['userId'],
    where: { userId: { in: [...userIds] }, ...IGNORED_ACTIONS_WHERE },
    _max: { createdAt: true },
  })
  const pairs = latest
    .filter((row) => row.userId && row._max.createdAt)
    .map((row) => ({ userId: row.userId as string, createdAt: row._max.createdAt as Date }))
  if (pairs.length === 0) return []
  return prisma.auditLog.findMany({
    where: { OR: pairs, ...IGNORED_ACTIONS_WHERE },
    select: ACTION_SELECT,
    orderBy: [{ createdAt: 'desc' }, TIE_BREAKER],
  })
}

export async function findRecentActions(userId: string, take: number) {
  return prisma.auditLog.findMany({
    where: { userId, ...IGNORED_ACTIONS_WHERE },
    select: ACTION_SELECT,
    orderBy: [{ createdAt: 'desc' }, TIE_BREAKER],
    take,
  })
}

/**
 * Вуз объектов журнала — чтобы «Изменён статус этапа» читалось с «· ННГУ».
 * По запросу на вид объекта (вуз, связка, этап, встреча, документ), не на запись.
 */
export async function findActionUniversities(ids: {
  university: readonly string[]
  cooperation: readonly string[]
  stage: readonly string[]
  meeting: readonly string[]
  document: readonly string[]
}) {
  const uni = { select: { shortName: true, name: true } } as const
  const [universities, cooperations, stages, meetings, documents] = await Promise.all([
    ids.university.length
      ? prisma.university.findMany({ where: { id: { in: [...ids.university] } }, select: { id: true, shortName: true, name: true } })
      : [],
    ids.cooperation.length
      ? prisma.cooperation.findMany({ where: { id: { in: [...ids.cooperation] } }, select: { id: true, university: uni } })
      : [],
    ids.stage.length
      ? prisma.workflowStage.findMany({
          where: { id: { in: [...ids.stage] } },
          select: { id: true, cooperation: { select: { university: uni } } },
        })
      : [],
    ids.meeting.length
      ? prisma.meeting.findMany({
          where: { id: { in: [...ids.meeting] } },
          select: { id: true, university: uni, cooperation: { select: { university: uni } } },
        })
      : [],
    ids.document.length
      ? prisma.document.findMany({
          where: { id: { in: [...ids.document] } },
          select: { id: true, university: uni, cooperation: { select: { university: uni } } },
        })
      : [],
  ])
  const label = (value: { shortName: string | null; name: string } | null | undefined) =>
    value ? (value.shortName ?? value.name) : null
  const result = new Map<string, string | null>()
  for (const row of universities) result.set(`University:${row.id}`, label(row))
  for (const row of cooperations) result.set(`Cooperation:${row.id}`, label(row.university))
  for (const row of stages) result.set(`WorkflowStage:${row.id}`, label(row.cooperation.university))
  for (const row of meetings) result.set(`Meeting:${row.id}`, label(row.university ?? row.cooperation?.university))
  for (const row of documents) result.set(`Document:${row.id}`, label(row.university ?? row.cooperation?.university))
  return result
}

/** Связки сотрудника в работе — список для боковой панели, с этапами для текущего. */
export async function findMemberCooperations(userId: string) {
  return prisma.cooperation.findMany({
    where: { responsibleId: userId, status: { in: [...ACTIVE_COOPERATION_STATUSES] } },
    select: {
      id: true,
      status: true,
      isMock: true,
      universityId: true,
      university: { select: { name: true, shortName: true } },
      program: { select: { name: true } },
      stages: { select: { stageNumber: true, title: true, status: true, deadline: true } },
    },
    orderBy: [{ university: { name: 'asc' } }, { program: { name: 'asc' } }, TIE_BREAKER],
  })
}

export async function findMemberOverdueStages(userId: string, now: Date) {
  return prisma.workflowStage.findMany({
    where: { responsibleId: userId, ...overdueStageWhere(now) },
    select: STAGE_REF_SELECT,
    orderBy: [{ deadline: 'asc' }, TIE_BREAKER],
  })
}

/** Этапы сотрудника со сроком на этой неделе — ещё не закрытые, в незакрытых связках. */
export async function findMemberWeekStages(userId: string, week: { from: Date; to: Date }) {
  return prisma.workflowStage.findMany({
    where: {
      responsibleId: userId,
      deadline: { gte: week.from, lt: week.to },
      status: { in: [...OPEN_STAGE_STATUSES] },
      stageNumber: { not: CONTROL_STAGE_NUMBER },
      cooperation: { status: { in: [...OPEN_COOPERATION_STATUSES] } },
    },
    select: STAGE_REF_SELECT,
    orderBy: [{ deadline: 'asc' }, TIE_BREAKER],
  })
}
