import { assertCanSeeTeam } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import { notFound } from '@/shared/http/errors'
import { canBeResponsible } from '@/shared/contracts/enums'
import { AUDIT_ACTION_LABELS, AUDIT_OBJECT_TYPE_LABELS } from '@/shared/contracts/labels'
import type { AuditActionCode, AuditObjectType } from '@/shared/contracts/audit'
import type {
  TeamActionDto,
  TeamCooperationDto,
  TeamMeetingDto,
  TeamMemberDetailDto,
  TeamMemberDto,
  TeamOverviewDto,
  TeamStageRefDto,
} from '@/shared/contracts/team'
import { TEAM_RECENT_ACTIONS, TEAM_STALE_DAYS, TEAM_UNIVERSITIES_SHOWN } from '@/shared/config/team.config'
import { daysBetween } from '@/shared/utils/date'
import { findCurrentStage, isAutoManaged, isOverdue } from '@/modules/workflow/workflow.rules'
import { isClosedOnTime, onTimePercent } from './trend'
import { deliveryChannels } from '@/modules/notify-channels/notify-channels.service'
import { dueDateIso, isAssignmentOverdue, todayIso } from '@/modules/assignments/assignments.rules'
import type { AssignmentCountsDto } from '@/shared/contracts/assignment'
import type { ChannelId } from '@/shared/contracts/notify-channels'
import * as repo from './team.repo'
import {
  LOAD_RULE,
  availableMembers,
  averageLoad,
  daysSince,
  isMeetingAhead,
  isStale,
  loadLevel,
  memberLoad,
  moscowWeek,
  topUniversities,
} from './team.rules'

/**
 * Экран «Команда» (решение 203): кто что ведёт, у кого горит и кто может взять ещё.
 *
 * Права — `assertCanSeeTeam`: ADMIN, HEAD и эксперт хакатона (только чтение).
 * Последние действия отдаются только безопасными полями (`TeamActionDto`) — руководитель
 * видит, что человек работает, но полного журнала (`GET /api/audit`, только ADMIN) не получает.
 */

type TeamUser = Awaited<ReturnType<typeof repo.findTeamUsers>>[number]
type ActiveCooperation = Awaited<ReturnType<typeof repo.findActiveCooperations>>[number]
type StageRef = Awaited<ReturnType<typeof repo.findMemberOverdueStages>>[number]
type ActionRow = Awaited<ReturnType<typeof repo.findRecentActions>>[number]
type MeetingRow = Awaited<ReturnType<typeof repo.findWeekMeetings>>[number]

function toStageRef(stage: StageRef, now: Date): TeamStageRefDto {
  const deadline = stage.deadline as Date
  const overdue = isOverdue(deadline, stage.status, now)
  return {
    stageId: stage.id,
    stageNumber: stage.stageNumber,
    title: stage.title,
    status: stage.status,
    deadline: deadline.toISOString(),
    cooperationId: stage.cooperation.id,
    universityName: stage.cooperation.university.name,
    universityShortName: stage.cooperation.university.shortName,
    programName: stage.cooperation.program.name,
    daysOverdue: overdue ? Math.max(0, daysBetween(deadline, now)) : null,
  }
}

function actionKey(row: Pick<ActionRow, 'objectType' | 'objectId'>): string {
  return `${row.objectType}:${row.objectId}`
}

/** Объекты журнала, у которых можно назвать вуз, — по видам, для одного запроса на вид. */
function actionObjectIds(rows: readonly ActionRow[]) {
  const pick = (type: string) => [...new Set(rows.filter((row) => row.objectType === type).map((row) => row.objectId))]
  return {
    university: pick('University'),
    cooperation: pick('Cooperation'),
    stage: pick('WorkflowStage'),
    meeting: pick('Meeting'),
    document: pick('Document'),
  }
}

function toAction(row: ActionRow, universities: ReadonlyMap<string, string | null>): TeamActionDto {
  return {
    action: row.action,
    label: AUDIT_ACTION_LABELS[row.action as AuditActionCode] ?? row.action,
    objectLabel: AUDIT_OBJECT_TYPE_LABELS[row.objectType as AuditObjectType] ?? row.objectType,
    universityShortName: universities.get(actionKey(row)) ?? null,
    at: row.createdAt.toISOString(),
  }
}

/** Встречи недели — по сотрудникам, без повторов: ведёт и участвует — одна встреча. */
function meetingsByUser(rows: readonly MeetingRow[]): Map<string, MeetingRow[]> {
  const result = new Map<string, MeetingRow[]>()
  for (const row of rows) {
    const people = new Set([row.responsibleId, ...row.participants.map((item) => item.userId)])
    for (const userId of people) {
      if (!userId) continue
      const list = result.get(userId) ?? []
      list.push(row)
      result.set(userId, list)
    }
  }
  return result
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string | null): Map<string, T[]> {
  const result = new Map<string, T[]>()
  for (const row of rows) {
    const value = key(row)
    if (value === null) continue
    const list = result.get(value) ?? []
    list.push(row)
    result.set(value, list)
  }
  return result
}

interface Facts {
  cooperations: ActiveCooperation[]
  overdue: Map<string, number>
  nearest: StageRef[]
  meetings: MeetingRow[]
  letters: Map<string, number>
  completed: Awaited<ReturnType<typeof repo.findCompletedStagesWithDeadline>>
  lastActions: ActionRow[]
  /** Поручения (решение 207): открытые и просроченные на человека. */
  assignments: Map<string, AssignmentCountsDto>
  /** Куда уйдёт уведомление о новом поручении помимо колокольчика. */
  messengers: Map<string, ChannelId | null>
  assignmentsMock: boolean
}

/** Открытые и просроченные поручения по исполнителю — правилом списка поручений. */
function countAssignments(
  rows: Awaited<ReturnType<typeof repo.findOpenAssignments>>,
  now: Date,
): Map<string, AssignmentCountsDto> {
  const today = todayIso(now)
  const result = new Map<string, AssignmentCountsDto>()
  for (const row of rows) {
    const counts = result.get(row.assigneeId) ?? { open: 0, overdue: 0 }
    counts.open += 1
    if (isAssignmentOverdue(dueDateIso(row.dueAt), row.status, today)) counts.overdue += 1
    result.set(row.assigneeId, counts)
  }
  return result
}

/**
 * Все выборки сводки разом — постоянное число запросов на любую команду.
 * `allCooperations` — связки и этапы «в срок» без фильтра по людям: итоги сводки
 * тогда считаются по тому же множеству, что главная.
 */
async function collectFacts(
  userIds: readonly string[],
  now: Date,
  week: { from: Date; to: Date },
  allCooperations: boolean,
): Promise<Facts> {
  const [cooperations, overdue, nearest, meetings, letters, completed, lastActions, openAssignments, messengers] =
    await Promise.all([
      repo.findActiveCooperations(allCooperations ? null : userIds),
      repo.countOverdueByUser(userIds, now),
      repo.findNearestDeadlines(userIds, now),
      repo.findWeekMeetings(userIds, week),
      repo.countOpenLetterTasksByUser(userIds),
      repo.findCompletedStagesWithDeadline(allCooperations ? null : userIds),
      repo.findLastActions(userIds),
      repo.findOpenAssignments(userIds),
      deliveryChannels(userIds),
    ])
  return {
    cooperations,
    overdue,
    nearest,
    meetings,
    letters,
    completed,
    lastActions,
    assignments: countAssignments(openAssignments, now),
    messengers,
    assignmentsMock: openAssignments.some((row) => row.isMock),
  }
}

function buildMembers(
  users: readonly TeamUser[],
  facts: Facts,
  universities: ReadonlyMap<string, string | null>,
  now: Date,
  week: { from: Date; to: Date },
): TeamMemberDto[] {
  const coopsByUser = groupBy(facts.cooperations, (row) => row.responsibleId)
  const completedByUser = groupBy(facts.completed, (row) => row.responsibleId)
  const meetings = meetingsByUser(facts.meetings)
  const nearestByUser = new Map<string, StageRef>()
  // Выборка отсортирована по сроку: первый этап сотрудника — его ближайший.
  for (const stage of facts.nearest) {
    if (stage.responsibleId && !nearestByUser.has(stage.responsibleId)) nearestByUser.set(stage.responsibleId, stage)
  }
  const lastByUser = new Map<string, ActionRow>()
  for (const row of facts.lastActions) {
    if (row.userId && !lastByUser.has(row.userId)) lastByUser.set(row.userId, row)
  }

  return users.map((user) => {
    const coops = coopsByUser.get(user.id) ?? []
    const unis = topUniversities(
      coops.map((row) => ({ universityId: row.universityId, label: row.university.shortName ?? row.university.name })),
      TEAM_UNIVERSITIES_SHOWN,
    )
    const completed = completedByUser.get(user.id) ?? []
    const overdue = facts.overdue.get(user.id) ?? 0
    const userMeetings = meetings.get(user.id) ?? []
    const meetingsAhead = userMeetings.filter((row) => isMeetingAhead(row.date, now, week)).length
    const last = lastByUser.get(user.id) ?? null
    const days = daysSince(last?.createdAt ?? null, now)
    const nearest = nearestByUser.get(user.id)
    return {
      id: user.id,
      fullName: user.fullName,
      position: user.position,
      role: user.role,
      canBeResponsible: canBeResponsible(user.role),
      activeCooperations: coops.length,
      universitiesCount: unis.total,
      universities: unis.names,
      nearestDeadline: nearest ? toStageRef(nearest, now) : null,
      overdueStages: overdue,
      meetingsThisWeek: userMeetings.length,
      meetingsAhead,
      openLetterTasks: facts.letters.get(user.id) ?? 0,
      assignments: facts.assignments.get(user.id) ?? { open: 0, overdue: 0 },
      messenger: facts.messengers.get(user.id) ?? null,
      onTime: {
        closedOnTime: completed.filter(isClosedOnTime).length,
        closedWithDeadline: completed.length,
        percent: onTimePercent(completed),
      },
      lastAction: last ? toAction(last, universities) : null,
      daysSinceLastAction: days,
      isStale: isStale(days, TEAM_STALE_DAYS),
      load: memberLoad({ cooperations: coops.length, meetings: meetingsAhead, overdue }),
    }
  })
}

export async function teamOverview(user: CurrentUser, now: Date = new Date()): Promise<TeamOverviewDto> {
  assertCanSeeTeam(user)
  const week = moscowWeek(now)
  const users = await repo.findTeamUsers()
  const ids = users.map((item) => item.id)
  const facts = await collectFacts(ids, now, week, true)
  const universities = await repo.findActionUniversities(actionObjectIds(facts.lastActions))
  const members = buildMembers(users, facts, universities, now, week)

  const inTeam = new Set(ids)
  const average = averageLoad(members.map((member) => member.load))
  const closedOnTime = facts.completed.filter(isClosedOnTime).length

  return {
    members,
    summary: {
      averageLoad: average,
      averageLevel: average === null ? null : loadLevel(average),
      loadMembers: members.filter((member) => member.load !== null).length,
      stagesOnTime: {
        closedOnTime,
        closedWithDeadline: facts.completed.length,
        percent: onTimePercent(facts.completed),
      },
      activeCooperations: facts.cooperations.length,
      activeCooperationsOutsideTeam: facts.cooperations.filter((row) => !inTeam.has(row.responsibleId)).length,
      available: availableMembers(members),
    },
    week: { from: week.from.toISOString(), to: week.to.toISOString() },
    loadRule: LOAD_RULE,
    staleDays: TEAM_STALE_DAYS,
    containsMockData:
      facts.cooperations.some((row) => row.isMock) ||
      facts.completed.some((row) => row.cooperation.isMock) ||
      facts.assignmentsMock,
    generatedAt: now.toISOString(),
  }
}

function toCooperation(row: Awaited<ReturnType<typeof repo.findMemberCooperations>>[number], now: Date): TeamCooperationDto {
  const current = findCurrentStage(row.stages)
  return {
    id: row.id,
    status: row.status,
    universityId: row.universityId,
    universityName: row.university.name,
    universityShortName: row.university.shortName,
    programName: row.program.name,
    currentStage: current
      ? {
          stageNumber: current.stageNumber,
          title: current.title,
          deadline: current.deadline ? current.deadline.toISOString() : null,
          isOverdue: isOverdue(current.deadline, current.status, now),
        }
      : null,
    overdueStages: row.stages.filter(
      (stage) => !isAutoManaged(stage.stageNumber) && isOverdue(stage.deadline, stage.status, now),
    ).length,
    isMock: row.isMock,
  }
}

function toMeeting(row: MeetingRow, userId: string, now: Date, week: { from: Date; to: Date }): TeamMeetingDto {
  const university = row.university ?? row.cooperation?.university ?? null
  return {
    id: row.id,
    date: row.date.toISOString(),
    topic: row.topic,
    format: row.format,
    universityShortName: university ? (university.shortName ?? university.name) : null,
    cooperationId: row.cooperationId,
    role: row.responsibleId === userId ? 'RESPONSIBLE' : 'PARTICIPANT',
    isAhead: isMeetingAhead(row.date, now, week),
  }
}

export async function teamMemberDetail(
  user: CurrentUser,
  userId: string,
  now: Date = new Date(),
): Promise<TeamMemberDetailDto> {
  assertCanSeeTeam(user)
  const [found] = await repo.findTeamUsers(userId)
  if (!found) throw notFound('Сотрудник не найден в команде')

  const week = moscowWeek(now)
  const [facts, cooperations, overdueStages, weekStages, recent] = await Promise.all([
    collectFacts([found.id], now, week, false),
    repo.findMemberCooperations(found.id),
    repo.findMemberOverdueStages(found.id, now),
    repo.findMemberWeekStages(found.id, week),
    repo.findRecentActions(found.id, TEAM_RECENT_ACTIONS),
  ])
  const universities = await repo.findActionUniversities(actionObjectIds([...facts.lastActions, ...recent]))
  const [member] = buildMembers([found], facts, universities, now, week)

  return {
    member: member!,
    cooperations: cooperations.map((row) => toCooperation(row, now)),
    overdueStages: overdueStages.map((stage) => toStageRef(stage, now)),
    weekStages: weekStages.map((stage) => toStageRef(stage, now)),
    weekMeetings: facts.meetings.map((row) => toMeeting(row, found.id, now, week)),
    recentActions: recent.map((row) => toAction(row, universities)),
    week: { from: week.from.toISOString(), to: week.to.toISOString() },
    loadRule: LOAD_RULE,
    staleDays: TEAM_STALE_DAYS,
    containsMockData: cooperations.some((row) => row.isMock),
    generatedAt: now.toISOString(),
  }
}
