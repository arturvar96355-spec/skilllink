import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { AppError } from '@/shared/http/errors'
import { ACTIVE_COOPERATION_STATUSES } from '@/shared/contracts/enums'
import type { UserRole } from '@/shared/contracts/enums'

/**
 * Экран «Команда» (решение 203) против поддельного клиента Prisma: права, отсутствие
 * N+1 (число запросов не растёт с числом сотрудников), та же база подсчёта, что у главной
 * и личного кабинета, и безопасные поля журнала.
 */

interface Call {
  model: string
  method: string
  args: Record<string, unknown>
}

const state = vi.hoisted(() => ({ calls: [] as Call[], people: 3 }))

const NOW = new Date('2026-09-24T09:00:00.000Z') // четверг
const past = (days: number) => new Date(NOW.getTime() - days * 86_400_000)
const future = (days: number) => new Date(NOW.getTime() + days * 86_400_000)

function userIds(): string[] {
  return Array.from({ length: state.people }, (_, index) => `u${index}`)
}

/**
 * Ответ поддельной базы по модели, методу и форме запроса. Данные растут с числом
 * сотрудников — а число запросов не должно.
 */
function respond(model: string, method: string, args: Record<string, unknown>): unknown {
  const where = (args.where ?? {}) as Record<string, unknown>
  const ids = userIds()
  switch (`${model}.${method}`) {
    case 'user.findMany':
      return ids.filter((id) => !where.id || where.id === id).map((id, index) => ({
        id,
        fullName: `Сотрудник ${index}`,
        position: null,
        role: (index === 0 ? 'HEAD' : 'MANAGER') as UserRole,
      }))
    case 'cooperation.findMany':
      if (where.id) return []
      // По 3 связки на человека и 2 связки у того, кого в команде нет (эксперт).
      return [
        ...ids.flatMap((id) =>
          [0, 1, 2].map((n) => ({
            id: `c-${id}-${n}`,
            status: 'ACTIVE',
            program: { name: 'Программа' },
            stages: [{ stageNumber: 5, title: 'Доработка документов', status: 'IN_PROGRESS', deadline: past(2) }],
            responsibleId: id,
            universityId: `uni${n}`,
            isMock: true,
            university: { name: `Вуз ${n}`, shortName: `В${n}` },
          })),
        ),
        ...[0, 1].map((n) => ({
          id: `c-outsider-${n}`,
          status: 'ACTIVE',
          program: { name: 'Программа' },
          stages: [],
          responsibleId: 'outsider',
          universityId: 'uni9',
          isMock: true,
          university: { name: 'Вуз 9', shortName: null },
        })),
      ]
    case 'workflowStage.groupBy':
      if (args._count) return ids.map((id) => ({ responsibleId: id, _count: { _all: 1 } }))
      return ids.map((id) => ({ responsibleId: id, _min: { deadline: future(2) } }))
    case 'workflowStage.findMany':
      if (where.id) return []
      if (where.status === 'COMPLETED') {
        // У каждого: 3 в срок, 1 с опозданием; ещё 2 этапа — у того, кого нет в команде.
        const stage = (responsibleId: string, late: boolean) => ({
          responsibleId,
          deadline: past(10),
          completedAt: late ? past(5) : past(12),
          cooperation: { isMock: true },
        })
        return [
          ...ids.flatMap((id) => [stage(id, false), stage(id, false), stage(id, false), stage(id, true)]),
          stage('outsider', false),
          stage('outsider', true),
        ]
      }
      return ids.map((id) => ({
        id: `s-${id}`,
        stageNumber: 6,
        title: 'Подписание документов',
        status: 'NOT_STARTED',
        deadline: future(2),
        responsibleId: id,
        cooperation: { id: `c-${id}`, university: { name: 'Вуз 0', shortName: 'В0' }, program: { name: 'Программа' } },
      }))
    case 'meeting.findMany':
      if (where.id) return []
      return ids.map((id) => ({
        id: `m-${id}`,
        date: future(1),
        topic: 'Встреча',
        format: 'ONLINE',
        responsibleId: id,
        cooperationId: null,
        participants: [{ userId: id }],
        university: null,
        cooperation: null,
      }))
    case 'inboundLetterTask.groupBy':
      return ids.map((id) => ({ responsibleId: id, _count: { _all: 2 } }))
    case 'auditLog.groupBy':
      return ids.map((id) => ({ userId: id, _max: { createdAt: past(1) } }))
    case 'auditLog.findMany': {
      const types = ['University', 'Cooperation', 'WorkflowStage', 'Meeting', 'Document']
      return ids.map((id, index) => ({
        userId: id,
        action: 'stage.status.change',
        objectType: types[index % types.length],
        objectId: `obj-${index}`,
        createdAt: past(1),
      }))
    }
    case 'university.findMany':
    case 'document.findMany':
      return []
    default:
      return []
  }
}

vi.mock('@/shared/db/prisma', () => {
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_target, method: string) =>
          async (args: Record<string, unknown> = {}) => {
            state.calls.push({ model: name, method, args })
            return respond(name, method, args)
          },
      },
    )
  return { prisma: new Proxy({}, { get: (_target, name: string) => model(name) }) }
})

const { teamOverview, teamMemberDetail } = await import('./team.service')
const analyticsRepo = await import('./analytics.repo')

function user(role: UserRole, isReviewer = false): CurrentUser {
  return { id: 'viewer', email: 'x@example.invalid', fullName: 'Смотрящий', role, universityId: null, isReviewer }
}

beforeEach(() => {
  state.calls = []
  state.people = 3
})

describe('права (решение 203)', () => {
  it.each<UserRole>(['ADMIN', 'HEAD'])('%s видит команду', async (role) => {
    await expect(teamOverview(user(role), NOW)).resolves.toBeDefined()
  })

  it.each<UserRole>(['MANAGER', 'ANALYST', 'VIEWER', 'UNIVERSITY_REP'])('%s получает 403', async (role) => {
    await expect(teamOverview(user(role), NOW)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(teamMemberDetail(user(role), 'u1', NOW)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // Отказ — до любого запроса к базе: чужих данных не читаем даже впустую.
    expect(state.calls).toEqual([])
  })

  it.each<UserRole>(['MANAGER', 'ADMIN', 'HEAD'])('эксперт с ролью %s читает команду', async (role) => {
    await expect(teamOverview(user(role, true), NOW)).resolves.toBeDefined()
  })

  it('эксперт-представитель вуза — 403: сводка о сотрудниках вузу не показывается', async () => {
    const error = (await teamOverview(user('UNIVERSITY_REP', true), NOW).catch((e: unknown) => e)) as AppError
    expect(error.code).toBe('FORBIDDEN')
  })
})

describe('нет N+1', () => {
  it('число запросов сводки одно и то же на 4 и на 40 сотрудников', async () => {
    // От 5 человек в журнале есть все пять видов объектов (вуз, связка, этап, встреча,
    // документ) — одинаковая форма данных; меньше видов — меньше запросов, но не больше.
    state.people = 5
    await teamOverview(user('HEAD'), NOW)
    const small = state.calls.length

    state.calls = []
    state.people = 40
    await teamOverview(user('HEAD'), NOW)
    const large = state.calls.length

    expect(small).toBeGreaterThan(0)
    expect(large).toBe(small)
    // Потолок: 1 сотрудники + 7 выборок фактов (из них две — по два запроса) + 5 на вузы журнала.
    expect(large).toBeLessThanOrEqual(15)
  })

  it('запросы групповые: никакой выборки по одному сотруднику в сводке', async () => {
    state.people = 5
    await teamOverview(user('HEAD'), NOW)
    const perUser = state.calls.filter((call) => {
      const where = (call.args.where ?? {}) as Record<string, unknown>
      return typeof where.responsibleId === 'string' || typeof where.userId === 'string'
    })
    expect(perUser).toEqual([])
  })
})

describe('та же база подсчёта, что у главной и личного кабинета', () => {
  it('связки в работе — статусы «Активных связей» главной и без фильтра по людям', async () => {
    await teamOverview(user('HEAD'), NOW)
    const coop = state.calls.find((call) => call.model === 'cooperation' && call.method === 'findMany')!
    const where = coop.args.where as { status: { in: string[] }; responsibleId?: unknown }
    expect(where.status.in).toEqual([...ACTIVE_COOPERATION_STATUSES])
    expect(where.responsibleId).toBeUndefined()
  })

  it('сумма по строкам + «вне команды» = всего связок в работе', async () => {
    const result = await teamOverview(user('HEAD'), NOW)
    const sum = result.members.reduce((total, member) => total + member.activeCooperations, 0)
    expect(sum + result.summary.activeCooperationsOutsideTeam).toBe(result.summary.activeCooperations)
    expect(result.summary.activeCooperations).toBe(3 * 3 + 2)
  })

  it('этапы в срок — та же выборка, что у главной, и та же доля', async () => {
    await analyticsRepo.findCompletedStagesWithDeadline({})
    const dashboardWhere = state.calls.at(-1)!.args.where

    state.calls = []
    const result = await teamOverview(user('HEAD'), NOW)
    const teamCall = state.calls.find(
      (call) => call.model === 'workflowStage' && call.method === 'findMany' &&
        (call.args.where as Record<string, unknown>).status === 'COMPLETED',
    )!
    expect(teamCall.args.where).toEqual(dashboardWhere)
    // 3 × (3 из 4) + (1 из 2) = 10 из 14 → 71,4 %.
    expect(result.summary.stagesOnTime).toEqual({ closedOnTime: 10, closedWithDeadline: 14, percent: 71.4 })
    expect(result.members[1]!.onTime).toEqual({ closedOnTime: 3, closedWithDeadline: 4, percent: 75 })
  })

  it('просрочено — то же условие, что в личном кабинете (isOverdue: начатые этапы после срока)', async () => {
    await analyticsRepo.countOverdueStagesOf('u1', NOW)
    const { responsibleId: _ignored, ...personal } = state.calls.at(-1)!.args.where as Record<string, unknown>

    state.calls = []
    await teamOverview(user('HEAD'), NOW)
    const teamCall = state.calls.find(
      (call) => call.model === 'workflowStage' && call.method === 'groupBy' && call.args._count,
    )!
    const { responsibleId: _team, ...team } = teamCall.args.where as Record<string, unknown>
    expect(team).toEqual(personal)
    expect((personal.status as { in: string[] }).in).toEqual(['IN_PROGRESS', 'BLOCKED'])
  })
})

describe('строка сотрудника', () => {
  it('нагрузка = связки + встречи + 3 × просрочки; ближайший срок и письма на месте', async () => {
    const result = await teamOverview(user('HEAD'), NOW)
    const member = result.members[1]!
    expect(member.load).toEqual({ points: 3 + 1 + 3 * 1, level: 'NORMAL', cooperations: 3, meetings: 1, overdue: 1 })
    expect(member.nearestDeadline).toMatchObject({ stageNumber: 6, universityShortName: 'В0', daysOverdue: null })
    expect(member.openLetterTasks).toBe(2)
    expect(member.universities).toEqual(['В0', 'В1', 'В2'])
    expect(member.isStale).toBe(false)
  })

  it('последнее действие — только безопасные поля: без идентификаторов и подробностей', async () => {
    const result = await teamOverview(user('HEAD'), NOW)
    const action = result.members[0]!.lastAction!
    expect(Object.keys(action).sort()).toEqual(['action', 'at', 'label', 'objectLabel', 'universityShortName'])
    expect(action.label).toBe('Изменён статус этапа')
    expect(JSON.stringify(result)).not.toContain('obj-')
  })

  it('в журнал за подробностями сводка не ходит: payload не запрашивается', async () => {
    await teamOverview(user('HEAD'), NOW)
    const audit = state.calls.filter((call) => call.model === 'auditLog' && call.method === 'findMany')
    for (const call of audit) {
      expect((call.args.select as Record<string, unknown>).payload).toBeUndefined()
    }
  })
})

describe('боковая панель сотрудника', () => {
  it('незнакомый или не из команды — 404, а не пустая карточка', async () => {
    await expect(teamMemberDetail(user('HEAD'), 'nobody', NOW)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('строка в панели считается тем же правилом, что в сводке', async () => {
    const overview = await teamOverview(user('HEAD'), NOW)
    const detail = await teamMemberDetail(user('HEAD'), 'u0', NOW)
    expect(detail.member.load).toEqual(overview.members[0]!.load)
    expect(detail.member.overdueStages).toBe(overview.members[0]!.overdueStages)
    expect(detail.weekMeetings[0]).toMatchObject({ role: 'RESPONSIBLE', topic: 'Встреча' })
    for (const action of detail.recentActions) {
      expect(Object.keys(action).sort()).toEqual(['action', 'at', 'label', 'objectLabel', 'universityShortName'])
    }
  })
})
