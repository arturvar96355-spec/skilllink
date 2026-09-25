/**
 * Пробник: ищет то, что не ловит сквозной сценарий.
 *
 * Сквозной сценарий проверяет, что система делает то, что должна. Этот скрипт проверяет,
 * что она НЕ делает того, чего не должна: не пускает к чужим данным, не оставляет
 * противоречивых состояний, не падает на кривом вводе.
 *
 * Запуск: npm run dev, затем npm run probe
 */
import 'dotenv/config'
import { createHash } from 'node:crypto'
import { RECOMMENDATION_SORT_MOST_IMPORTANT } from '../src/shared/contracts/recommendation'
import { REAUTH_PARAM } from '../src/shared/auth/reauth'
import { isLockedByControlPoint } from '@/modules/workflow/workflow.rules'
import type { StageStatus } from '@/shared/contracts/enums'
import {
  PROGRAM_RATING_WEIGHTS,
  RECOMMENDATION_RULES,
  SKILL_GAP,
} from '@/shared/config/analytics.config'
import { CONTROL_POINT_STAGES, WORKFLOW_STAGES } from '@/shared/config/workflow.config'

const BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:3000'

let passed = 0
let failed = 0
const failures: string[] = []

const GREEN = '[32m'
const RED = '[31m'
const GREY = '[90m'
const BOLD = '[1m'
const RESET = '[0m'

let actingUserId: string | null = null

function actAs(userId: string | null): void {
  actingUserId = userId
}

interface Result<T> {
  status: number
  body: {
    data?: T
    meta?: Record<string, unknown>
    error?: { code: string; message: string; details?: unknown }
  }
  raw: string
}

async function call<T>(method: string, path: string, body?: unknown): Promise<Result<T>> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (actingUserId) headers.cookie = `skilllink_user=${actingUserId}`

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const raw = await response.text()
  let parsed: Result<T>['body']
  try {
    parsed = raw ? JSON.parse(raw) : {}
  } catch {
    parsed = {}
  }
  return { status: response.status, body: parsed, raw }
}

/** Запрос с сырым телом: проверка того, как система переносит некорректный ввод. */
async function callRaw(method: string, path: string, body: string, contentType: string) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'content-type': contentType,
      ...(actingUserId ? { cookie: `skilllink_user=${actingUserId}` } : {}),
    },
    body,
  })
  return { status: response.status, text: await response.text() }
}

function check(name: string, condition: boolean, detail = ''): void {
  const suffix = detail ? ` ${GREY}${detail}${RESET}` : ''
  if (condition) {
    passed += 1
    console.log(`  ${GREEN}OK${RESET}   ${name}${suffix}`)
  } else {
    failed += 1
    failures.push(name)
    console.log(`  ${RED}FAIL${RESET} ${name}${suffix}`)
  }
}

function step(title: string): void {
  console.log(`\n${BOLD}${title}${RESET}`)
}

/**
 * Прогрев маршрутов перед проверками.
 *
 * В режиме разработки Next собирает каждый маршрут при первом обращении.
 * Пока идёт сборка, запрос может вернуть 404 на существующий адрес — и проверка
 * падает не из-за приложения, а из-за того, что оно ещё собирается.
 *
 * В CI этого не видно: там промышленная сборка, где всё собрано заранее.
 */
async function warmUp(): Promise<void> {
  const routes = [
    '/api/health',
    '/api/users',
    '/api/me',
    '/api/analytics/overview',
    '/api/analytics/programs',
    '/api/universities?pageSize=1',
    '/api/programs?pageSize=1',
    '/api/cooperations?pageSize=1',
    '/api/documents?pageSize=1',
    '/api/meetings?pageSize=1',
    '/api/recommendations?pageSize=1',
    '/api/skills?pageSize=1',
    '/api/skills/warm-up',
    '/api/skills/warm-up/merge',
    '/api/settings/parameters',
    '/api/skills/gaps',
    '/api/skills/demand',
    '/api/products?pageSize=1',
    '/api/workflow/overdue',
    '/api/workflow/blocked',
    '/api/audit?pageSize=1',
    '/api/me/password',
    '/api/users/warm-up',
    '/api/users/warm-up/password-reset',
    '/api/data-sources',
    '/api/data-sources/sync',
    '/api/integrations/status',
    '/api/document-templates',
    '/api/export?dataset=universities&limit=1',
    '/api/portal/overview',
    '/api/openapi.json',
    '/api/me/calendar',
    '/api/calendar/warm-up.ics',
    '/api/admin/dsar/requests',
    '/api/admin/dsar/users/warm-up/export',
    '/api/admin/dsar/contacts/warm-up/export',
    '/api/admin/dsar/users/warm-up/erase',
    '/api/admin/dsar/contacts/warm-up/erase',
  ]

  await Promise.all(
    routes.map((route) =>
      fetch(`${BASE_URL}${route}`, {
        headers: actingUserId ? { cookie: `skilllink_user=${actingUserId}` } : {},
      })
        .then((response) => response.arrayBuffer())
        .catch(() => undefined),
    ),
  )
}

/**
 * Сколько просроченных этапов пользователя не начать из-за незавершённой
 * контрольной точки. Сроки берутся из общего списка просрочек, этапы связки —
 * из её карточки: правило то же, что у ленты (`isLockedByControlPoint`).
 */
async function countLockedOverdueOf(userId: string): Promise<number> {
  type Overdue = {
    cooperationId: string
    stageNumber: number
    status: StageStatus
    responsible: { id: string } | null
  }
  const rows: Overdue[] = []
  for (let page = 1; page <= 50; page += 1) {
    const chunk = await call<Overdue[]>('GET', `/api/workflow/overdue?page=${page}&pageSize=100`)
    rows.push(...(chunk.body.data ?? []))
    if ((chunk.body.data ?? []).length < 100) break
  }
  const stagesOf = new Map<string, Array<{ stageNumber: number; title: string; status: StageStatus }>>()
  let locked = 0
  for (const row of rows) {
    if (row.responsible?.id !== userId || row.status !== 'NOT_STARTED') continue
    if (!stagesOf.has(row.cooperationId)) {
      const card = await call<{ stages: Array<{ stageNumber: number; title: string; status: StageStatus }> }>(
        'GET',
        `/api/cooperations/${row.cooperationId}`,
      )
      stagesOf.set(row.cooperationId, card.body.data?.stages ?? [])
    }
    if (isLockedByControlPoint(row, stagesOf.get(row.cooperationId) ?? [])) locked += 1
  }
  return locked
}

/** Связка из списка связок, как её отдаёт реестр. */
type ProbeCooperation = { id: string; universityId: string; responsible: { id: string } }

/**
 * Общий контекст проверок: демо-данные, на которых они стоят. Берутся из справочников
 * через API до первого шага.
 */
interface ProbeContext {
  rep: { id: string; universityId: string | null } | undefined
  adminId: string | null
  managerId: string | null
  universities: Result<Array<{ id: string; name: string }>>
  foreignUniversity: { id: string; name: string } | undefined
  cooperations: Result<ProbeCooperation[]>
  foreignCooperation: ProbeCooperation | undefined
  anyCooperation: ProbeCooperation | undefined
}

async function prepare(): Promise<ProbeContext> {
  const reps = await call<Array<{ id: string; universityId: string | null }>>(
    'GET',
    '/api/users?role=UNIVERSITY_REP',
  )
  const rep = reps.body.data?.[0]
  const admins = await call<Array<{ id: string }>>('GET', '/api/users?role=ADMIN')
  const adminId = admins.body.data?.[0]?.id ?? null

  const universities = await call<Array<{ id: string; name: string }>>(
    'GET',
    '/api/universities?pageSize=50',
  )
  const foreignUniversity = (universities.body.data ?? []).find(
    (item) => item.id !== rep?.universityId,
  )

  const cooperations = await call<
    Array<{ id: string; universityId: string; responsible: { id: string } }>
  >('GET', '/api/cooperations?pageSize=50')
  const foreignCooperation = (cooperations.body.data ?? []).find(
    (item) => item.universityId !== rep?.universityId,
  )
  const anyCooperation = cooperations.body.data?.[0]
  // Ответственным назначается только менеджер или администратор — берём менеджера
  // из справочника, а не ответственного первой попавшейся связки.
  const managers = await call<Array<{ id: string }>>('GET', '/api/users?role=MANAGER&pageSize=1')
  const managerId = managers.body.data?.[0]?.id ?? null

  return { rep, adminId, managerId, universities, foreignUniversity, cooperations, foreignCooperation, anyCooperation }
}

async function checkRepIsolation(ctx: ProbeContext): Promise<void> {
  step('1. Представитель вуза не должен видеть и трогать чужое')
  const { rep, foreignUniversity, foreignCooperation } = ctx

  if (!rep || !foreignUniversity || !foreignCooperation) {
    check('демо-данные готовы (представитель вуза и чужой вуз)', false, 'запустите npm run db:seed')
  } else {
    actAs(rep.id)

    const closedForRep: Array<[string, string, string]> = [
      ['GET', '/api/analytics/overview', 'аналитика'],
      ['GET', '/api/analytics/programs', 'рейтинг программ'],
      ['GET', '/api/recommendations', 'рекомендации'],
      ['GET', '/api/skills/gaps', 'дефициты навыков'],
      ['GET', '/api/skills/demand', 'востребованность навыков'],
      ['GET', '/api/users', 'справочник пользователей'],
      ['GET', '/api/data-sources', 'источники данных'],
      ['GET', '/api/integrations/status', 'состояние интеграций'],
      ['GET', '/api/audit', 'журнал действий'],
      ['GET', '/api/export?dataset=skill-gaps', 'выгрузка дефицитов навыков'],
    ]
    for (const [method, path, label] of closedForRep) {
      const result = await call(method, path)
      check(`${label}: закрыто для представителя`, result.status === 403, `статус ${result.status}`)
    }

    const foreignReads: Array<[string, string]> = [
      [`/api/universities/${foreignUniversity.id}`, 'чужой вуз'],
      [`/api/universities/${foreignUniversity.id}/events`, 'лента чужого вуза'],
      [`/api/cooperations/${foreignCooperation.id}`, 'чужая связка'],
      [`/api/cooperations/${foreignCooperation.id}/stages`, 'этапы чужой связки'],
    ]
    for (const [path, label] of foreignReads) {
      const result = await call('GET', path)
      check(`${label}: 404, а не 403`, result.status === 404, `статус ${result.status}`)
    }

    // Фильтры не должны становиться обходным путём.
    const byForeignCooperation = await call<unknown[]>(
      'GET',
      `/api/documents?cooperationId=${foreignCooperation.id}`,
    )
    check(
      'фильтр документов по чужой связке ничего не отдаёт',
      (byForeignCooperation.body.data?.length ?? 0) === 0,
      `${byForeignCooperation.body.data?.length ?? 0} записей`,
    )

    const meetingsByForeign = await call<unknown[]>(
      'GET',
      `/api/meetings?universityId=${foreignUniversity.id}`,
    )
    check(
      'фильтр встреч по чужому вузу ничего не отдаёт',
      (meetingsByForeign.body.data?.length ?? 0) === 0,
      `${meetingsByForeign.body.data?.length ?? 0} записей`,
    )

    const programsByForeign = await call<unknown[]>(
      'GET',
      `/api/programs?universityId=${foreignUniversity.id}`,
    )
    check(
      'фильтр программ по чужому вузу ничего не отдаёт',
      (programsByForeign.body.data?.length ?? 0) === 0,
      `${programsByForeign.body.data?.length ?? 0} записей`,
    )

    const exportForRep = await call('GET', '/api/export?dataset=universities')
    check('выгрузка вузов доступна представителю', exportForRep.status === 200)

    // Кабинет чужого вуза: параметр должен игнорироваться.
    const foreignPortal = await call<{ universityId: string }>(
      'GET',
      `/api/portal/overview?universityId=${foreignUniversity.id}`,
    )
    check(
      'кабинет игнорирует чужой universityId и отдаёт свой',
      foreignPortal.body.data?.universityId === rep.universityId,
      `вернулся ${foreignPortal.body.data?.universityId}`,
    )

    const foreignApplication = await call('POST', '/api/portal/applications', {
      programId: 'no-such-program',
      quantity: 1,
    })
    check('заявка на несуществующую программу отклоняется', foreignApplication.status === 422)

    actAs(null)
  }
}

async function checkNoContradictoryStates(ctx: ProbeContext): Promise<void> {
  step('2. Система не должна оставлять противоречивые состояния')
  const { anyCooperation, managerId } = ctx

  if (!managerId || !anyCooperation) {
    check('есть связка для проверок', false)
  } else {
    // Готовим собственную связку, чтобы не портить демо-данные.
    const uni = await call<{ id: string }>('POST', '/api/universities', {
      name: `Пробный университет ${Date.now().toString().slice(-6)}`,
      city: 'Пробинск',
      region: 'Пробная область',
    })
    const program = await call<{ id: string }>('POST', '/api/programs', {
      universityId: uni.body.data?.id,
      name: `Пробная программа ${Date.now().toString().slice(-6)}`,
      level: 'BACHELOR',
    })
    const probe = await call<{
      id: string
      stages: Array<{ id: string; stageNumber: number; tasks: Array<{ id: string; isRequired: boolean }> }>
    }>('POST', '/api/cooperations', {
      universityId: uni.body.data?.id,
      programId: program.body.data?.id,
      responsibleId: managerId,
      goal: 'Связка для пробника',
    })

    const probeId = probe.body.data?.id
    const stage1 = probe.body.data?.stages[0]
    check('пробная связка создана', Boolean(probeId && stage1), `статус ${probe.status}`)

    if (probeId && stage1) {
      // Закрываем этап 1 по правилам.
      await call('PATCH', `/api/workflow/stages/${stage1.id}`, { status: 'IN_PROGRESS' })
      for (const task of stage1.tasks.filter((item) => item.isRequired)) {
        await call('PATCH', `/api/workflow/tasks/${task.id}`, { isDone: true })
      }
      const completed = await call<{ status: string }>(
        'PATCH',
        `/api/workflow/stages/${stage1.id}`,
        { status: 'COMPLETED', result: 'Готово' },
      )
      check('этап закрыт по правилам', completed.body.data?.status === 'COMPLETED')

      // Снятие обязательного пункта с закрытого этапа сделало бы состояние противоречивым.
      const requiredTask = stage1.tasks.find((item) => item.isRequired)
      if (requiredTask) {
        const untoggle = await call<{ status: string; requiredTasksDone: number; requiredTasksTotal: number }>(
          'PATCH',
          `/api/workflow/tasks/${requiredTask.id}`,
          { isDone: false },
        )
        check(
          'нельзя снять обязательный пункт с завершённого этапа',
          untoggle.status === 409,
          `статус ${untoggle.status}${
            untoggle.status === 200
              ? `, стало ${untoggle.body.data?.requiredTasksDone}/${untoggle.body.data?.requiredTasksTotal} при статусе ${untoggle.body.data?.status}`
              : ''
          }`,
        )
      }

      // Закрытую связку нельзя править, даже передав её текущий статус.
      await call('PATCH', `/api/cooperations/${probeId}`, { status: 'COMPLETED' })
      const sneakyEdit = await call<{ goal: string | null }>(
        'PATCH',
        `/api/cooperations/${probeId}`,
        { status: 'COMPLETED', goal: 'Правка закрытой связки' },
      )
      check(
        'нельзя править закрытую связку, передав её же статус',
        sneakyEdit.status === 409,
        `статус ${sneakyEdit.status}`,
      )

      // Переоткрытие должно снимать дату закрытия.
      const reopened = await call<{ status: string; closedAt: string | null }>(
        'PATCH',
        `/api/cooperations/${probeId}`,
        { status: 'ACTIVE' },
      )
      check(
        'переоткрытие снимает дату закрытия',
        reopened.body.data?.status === 'ACTIVE' && reopened.body.data.closedAt === null,
        `closedAt = ${reopened.body.data?.closedAt}`,
      )

      // Контрольный этап не должен закрываться, пока открыты обычные.
      const stages = await call<Array<{ stageNumber: number; status: string }>>(
        'GET',
        `/api/cooperations/${probeId}/stages`,
      )
      const control = (stages.body.data ?? []).find((item) => item.stageNumber === 14)
      const others = (stages.body.data ?? []).filter((item) => item.stageNumber !== 14)
      const allClosed = others.every(
        (item) => item.status === 'COMPLETED' || item.status === 'CANCELLED',
      )
      check(
        'контрольный этап согласован с остальными',
        allClosed ? control?.status === 'COMPLETED' : control?.status !== 'COMPLETED',
        `контроль: ${control?.status}`,
      )
    }
  }
}

async function checkClosedCooperationFrozen(ctx: ProbeContext): Promise<void> {
  step('2а. У закрытой связки процесс заморожен')
  const { managerId } = ctx

  if (managerId) {
    const sfx = Date.now().toString().slice(-6)
    const uni = await call<{ id: string }>('POST', '/api/universities', {
      name: `Пробный вуз заморозки ${sfx}`,
      city: 'Тверь',
      region: 'Тверская область',
    })
    const program = await call<{ id: string }>('POST', '/api/programs', {
      universityId: uni.body.data?.id,
      name: `Пробная программа заморозки ${sfx}`,
      level: 'BACHELOR',
    })
    const closedCooperation = await call<{
      id: string
      stages: Array<{ id: string; tasks: Array<{ id: string }> }>
    }>('POST', '/api/cooperations', {
      universityId: uni.body.data?.id,
      programId: program.body.data?.id,
      responsibleId: managerId,
    })

    const closedId = closedCooperation.body.data?.id
    const someStage = closedCooperation.body.data?.stages[1]
    check('пробная связка для заморозки создана', Boolean(closedId && someStage))

    if (closedId && someStage) {
      await call('PATCH', `/api/cooperations/${closedId}`, { status: 'CANCELLED' })

      const moveStage = await call('PATCH', `/api/workflow/stages/${someStage.id}`, {
        status: 'IN_PROGRESS',
      })
      check(
        'этап закрытой связки не двигается',
        moveStage.status === 409,
        `статус ${moveStage.status}`,
      )

      const someTask = someStage.tasks[0]
      if (someTask) {
        const toggle = await call('PATCH', `/api/workflow/tasks/${someTask.id}`, { isDone: true })
        check(
          'чек-лист закрытой связки не меняется',
          toggle.status === 409,
          `статус ${toggle.status}`,
        )
      }

      const pack = await call('POST', `/api/cooperations/${closedId}/documents/generate`, {})
      check(
        'пакет документов для закрытой связки не собирается',
        pack.status === 409,
        `статус ${pack.status}`,
      )

      // Исторические записи после закрытия заносить можно: это то, что произошло.
      const lateMeeting = await call('POST', '/api/meetings', {
        cooperationId: closedId,
        date: new Date().toISOString(),
        topic: 'Итоговая встреча после закрытия',
        responsibleId: managerId,
      })
      check(
        'встречу по закрытой связке занести можно: это запись о прошлом',
        lateMeeting.status === 201,
        `статус ${lateMeeting.status}`,
      )

      // Переоткрыли — процесс снова доступен.
      await call('PATCH', `/api/cooperations/${closedId}`, { status: 'ACTIVE' })
      const afterReopen = await call('PATCH', `/api/workflow/stages/${someStage.id}`, {
        status: 'IN_PROGRESS',
      })
      check(
        'после переоткрытия этапы снова двигаются',
        afterReopen.status === 200,
        `статус ${afterReopen.status}`,
      )
    }
  }
}

async function checkPortalMaterialConfirmation(ctx: ProbeContext): Promise<void> {
  step('2б. Кабинет вуза подтверждает материалы по тем же правилам, что сотрудник')
  const { rep, managerId } = ctx

  if (rep?.universityId && managerId) {
    const sfx = Date.now().toString().slice(-6)
    const program = await call<{ id: string }>('POST', '/api/programs', {
      universityId: rep.universityId,
      name: `Пробная программа материалов ${sfx}`,
      level: 'BACHELOR',
    })
    const cooperation = await call<{
      id: string
      stages: Array<{ id: string; stageNumber: number; tasks: Array<{ id: string }> }>
    }>('POST', '/api/cooperations', {
      universityId: rep.universityId,
      programId: program.body.data?.id,
      responsibleId: managerId,
    })
    const materialsStage = cooperation.body.data?.stages.find((stage) => stage.stageNumber === 7)
    const cancel = materialsStage
      ? await call('PATCH', `/api/workflow/stages/${materialsStage.id}`, {
          status: 'CANCELLED',
          comment: 'Пробник: материалы передаются по другому договору',
        })
      : null
    check(
      'пробная связка с отменённым этапом 7 готова',
      Boolean(materialsStage && cancel?.status === 200),
      `статус отмены ${cancel?.status}`,
    )

    const task = materialsStage?.tasks[0]
    if (task && cancel?.status === 200) {
      actAs(rep.id)
      const list = await call<Array<{ taskId: string; canConfirm: boolean }>>(
        'GET',
        '/api/portal/materials',
      )
      const listed = (list.body.data ?? []).find((item) => item.taskId === task.id)
      check(
        'пункт отменённого этапа не предлагается к подтверждению',
        listed?.canConfirm === false,
        `canConfirm ${listed?.canConfirm}`,
      )

      const confirm = await call('POST', `/api/portal/materials/${task.id}/confirm`, {})
      check(
        'подтверждение по отменённому этапу отклонено, как у сотрудника',
        confirm.status === 409,
        `статус ${confirm.status}`,
      )

      // Повтор уже подтверждённого — не изменение: ответ 200 даже в завершённом этапе.
      const done = await call<Array<{ taskId: string; isConfirmed: boolean; stageStatus: string }>>(
        'GET',
        '/api/portal/materials',
      )
      const confirmedEarlier = (done.body.data ?? []).find(
        (item) => item.isConfirmed && item.stageStatus === 'COMPLETED',
      )
      if (confirmedEarlier) {
        const repeat = await call('POST', `/api/portal/materials/${confirmedEarlier.taskId}/confirm`, {})
        check(
          'повторное подтверждение в завершённом этапе безвредно',
          repeat.status === 200,
          `статус ${repeat.status}`,
        )
      }

      const overview = await call<{ pendingMaterials: number }>('GET', '/api/portal/overview')
      const confirmable = (list.body.data ?? []).filter((item) => item.canConfirm).length
      check(
        '«Материалы к подтверждению» считают только то, что можно подтвердить',
        overview.body.data?.pendingMaterials === confirmable,
        `в обзоре ${overview.body.data?.pendingMaterials}, в списке ${confirmable}`,
      )
      actAs(null)

      const reread = await call<{ stages: Array<{ tasks: Array<{ id: string; isDone: boolean }> }> }>(
        'GET',
        `/api/cooperations/${cooperation.body.data?.id}`,
      )
      const after = (reread.body.data?.stages ?? [])
        .flatMap((item) => item.tasks)
        .find((item) => item.id === task.id)
      check('пункт отменённого этапа остался неотмеченным', after?.isDone === false, `isDone ${after?.isDone}`)
    }
  }
}

async function checkUniversityItemMarking(ctx: ProbeContext): Promise<void> {
  step('2в. Пункт вуза: при представителе отмечает вуз, без него — сотрудник с пометкой (решение 103)')
  const { rep, adminId, managerId } = ctx

  if (rep?.universityId && managerId) {
    type ProbeTask = {
      id: string
      title: string
      isRequired: boolean
      isDone: boolean
      isUniversityItem: boolean
      staffMarkRule: string
      confirmationNote: string | null
    }
    type ProbeStage = { id: string; stageNumber: number; tasks: ProbeTask[] }

    /**
     * Новая связка вуза с закрытыми этапами 1–6: пункты этапа 7 — контрольной
     * точки — отмечаются только после них. Своя связка, а не демо-набор: пробник
     * не должен менять то, что потом сверяет demo:check.
     */
    const cooperationAtMaterials = async (universityId: string, label: string) => {
      const sfx = Date.now().toString().slice(-6)
      const program = await call<{ id: string }>('POST', '/api/programs', {
        universityId,
        name: `Пробная программа пункта вуза ${label} ${sfx}`,
        level: 'BACHELOR',
      })
      const created = await call<{ id: string; stages: ProbeStage[] }>('POST', '/api/cooperations', {
        universityId,
        programId: program.body.data?.id,
        responsibleId: managerId,
      })
      const stages = created.body.data?.stages ?? []
      for (const stage of stages.filter((item) => item.stageNumber <= 6)) {
        if (stage.stageNumber === 5) {
          await call('PATCH', `/api/workflow/stages/${stage.id}`, {
            status: 'CANCELLED',
            comment: 'Не требуется для этой связки',
          })
          continue
        }
        await call('PATCH', `/api/workflow/stages/${stage.id}`, { status: 'IN_PROGRESS' })
        for (const task of stage.tasks) {
          await call('PATCH', `/api/workflow/tasks/${task.id}`, { isDone: true })
        }
        await call('PATCH', `/api/workflow/stages/${stage.id}`, { status: 'COMPLETED', result: 'Готово' })
      }
      const materials = stages.find((item) => item.stageNumber === 7)
      return {
        cooperationId: created.body.data?.id ?? null,
        stageId: materials?.id ?? null,
        item: materials?.tasks.find((task) => task.isUniversityItem) ?? null,
      }
    }
    const itemOf = (stage: ProbeStage | undefined, taskId: string) =>
      stage?.tasks.find((task) => task.id === taskId)

    // Вуз с представителем (демо: СПбГУТ).
    actAs(null)
    const withRep = await cooperationAtMaterials(rep.universityId, 'с представителем')
    check(
      'у связки есть пункт вуза «Вуз подтвердил получение материалов»',
      withRep.item?.title === 'Вуз подтвердил получение материалов',
      `пункт ${withRep.item?.title ?? 'не найден'}`,
    )
    if (withRep.item) {
      check(
        'в DTO пункта вуза при представителе — UNIVERSITY_ONLY',
        withRep.item.staffMarkRule === 'UNIVERSITY_ONLY',
        `staffMarkRule ${withRep.item.staffMarkRule}`,
      )
      const byStaff = await call('PATCH', `/api/workflow/tasks/${withRep.item.id}`, {
        isDone: true,
        confirmationNote: 'письмо от 12.09',
      })
      check(
        'сотрудник не отмечает пункт вуза, у которого есть представитель: 403',
        byStaff.status === 403 &&
          byStaff.body.error?.message === 'Этот пункт отмечает представитель вуза в кабинете вуза',
        `статус ${byStaff.status}: ${byStaff.body.error?.message ?? ''}`,
      )

      actAs(rep.id)
      const byRep = await call<Array<{ taskId: string; isConfirmed: boolean }>>(
        'POST',
        `/api/portal/materials/${withRep.item.id}/confirm`,
        {},
      )
      check(
        'представитель вуза подтверждает этот пункт в кабинете: 200',
        byRep.status === 200 &&
          byRep.body.data?.find((item) => item.taskId === withRep.item?.id)?.isConfirmed === true,
        `статус ${byRep.status}`,
      )
      actAs(null)

      const unmark = await call('PATCH', `/api/workflow/tasks/${withRep.item.id}`, { isDone: false })
      check(
        'снять подтверждение вуза сотрудник тоже не может: 403',
        unmark.status === 403,
        `статус ${unmark.status}`,
      )
    }

    // Вуз без представителя — только что созданный.
    const sfx = Date.now().toString().slice(-6)
    const lonely = await call<{ id: string }>('POST', '/api/universities', {
      name: `Пробный вуз без представителя ${sfx}`,
      city: 'Тверь',
      region: 'Тверская область',
    })
    const noRep = lonely.body.data?.id
      ? await cooperationAtMaterials(lonely.body.data.id, 'без представителя')
      : null
    const item = noRep?.item
    if (!item || !noRep?.stageId) {
      check('пробная связка вуза без представителя готова', false, `статус вуза ${lonely.status}`)
    } else {
      check(
        'в DTO пункта вуза без представителя — NOTE_REQUIRED',
        item.staffMarkRule === 'NOTE_REQUIRED',
        `staffMarkRule ${item.staffMarkRule}`,
      )
      const bare = await call('PATCH', `/api/workflow/tasks/${item.id}`, { isDone: true })
      const bareFields = Array.isArray(bare.body.error?.details)
        ? (bare.body.error.details as Array<{ field?: string }>).map((detail) => detail.field)
        : []
      check(
        'без представителя отметка без пометки — 422 по полю confirmationNote',
        bare.status === 422 &&
          bare.body.error?.code === 'VALIDATION_ERROR' &&
          bareFields.includes('confirmationNote'),
        `статус ${bare.status}, поля ${bareFields.join(', ')}`,
      )
      const tooShort = await call('PATCH', `/api/workflow/tasks/${item.id}`, {
        isDone: true,
        confirmationNote: 'ок',
      })
      check('пометка короче 3 символов — 422', tooShort.status === 422, `статус ${tooShort.status}`)

      const noted = await call<ProbeStage>('PATCH', `/api/workflow/tasks/${item.id}`, {
        isDone: true,
        confirmationNote: 'письмо от 12.09',
      })
      const markedItem = itemOf(noted.body.data, item.id)
      check(
        'с пометкой — 200, пометка сохранена в пункте',
        noted.status === 200 &&
          markedItem?.isDone === true &&
          markedItem.confirmationNote === 'письмо от 12.09',
        `статус ${noted.status}, пометка ${markedItem?.confirmationNote ?? null}`,
      )

      // Журнал: отдельное действие, без текста пометки. Журнал читает только администратор.
      actAs(adminId)
      const audit = await call<Array<{ action: string; objectId: string; payload: Record<string, unknown> | null }>>(
        'GET',
        `/api/audit?objectType=Task&objectId=${item.id}&pageSize=10`,
      )
      actAs(null)
      const entry = (audit.body.data ?? []).find(
        (row) => row.objectId === item.id && row.action === 'task.university-item.confirm-by-staff',
      )
      check(
        'в журнале отдельное действие с длиной пометки, без её текста',
        Boolean(entry) &&
          entry?.payload?.noteLength === 'письмо от 12.09'.length &&
          !JSON.stringify(entry?.payload ?? {}).includes('письмо'),
        entry ? JSON.stringify(entry.payload) : `статус журнала ${audit.status}`,
      )

      const cleared = await call<ProbeStage>('PATCH', `/api/workflow/tasks/${item.id}`, { isDone: false })
      const clearedItem = itemOf(cleared.body.data, item.id)
      check(
        'снять отметку можно без пометки — пометка стирается',
        cleared.status === 200 && clearedItem?.isDone === false && clearedItem.confirmationNote === null,
        `статус ${cleared.status}, пометка ${clearedItem?.confirmationNote ?? null}`,
      )
    }
  }
}

async function checkMalformedInput(): Promise<void> {
  step('3. Кривой ввод не должен ронять систему')

  const malformed = await callRaw('POST', '/api/universities', '{не json', 'application/json')
  check('битый JSON отклоняется с 422', malformed.status === 422, `статус ${malformed.status}`)

  const wrongType = await callRaw('POST', '/api/universities', 'name=Вуз', 'text/plain')
  check(
    'тело не в JSON отклоняется, а не роняет сервер',
    wrongType.status === 422 || wrongType.status === 415,
    `статус ${wrongType.status}`,
  )

  const emptyBody = await callRaw('POST', '/api/universities', '', 'application/json')
  check('пустое тело отклоняется', emptyBody.status === 422, `статус ${emptyBody.status}`)

  const arrayBody = await call('POST', '/api/universities', [1, 2, 3])
  check('массив вместо объекта отклоняется', arrayBody.status === 422)

  const nullBody = await call('POST', '/api/universities', null)
  check('null вместо объекта отклоняется', nullBody.status === 422)

  const longName = 'А'.repeat(5000)
  const tooLong = await call('POST', '/api/universities', {
    name: longName,
    city: 'Москва',
    region: 'Москва',
  })
  check('слишком длинное название отклоняется', tooLong.status === 422)

  const sqlish = await call<unknown[]>(
    'GET',
    `/api/universities?q=${encodeURIComponent("'; DROP TABLE universities; --")}`,
  )
  check('строка, похожая на SQL, безопасно обрабатывается', sqlish.status === 200)

  const stillAlive = await call<unknown[]>('GET', '/api/universities?pageSize=1')
  check(
    'таблица вузов на месте после этого',
    stillAlive.status === 200 && (stillAlive.body.data?.length ?? 0) > 0,
  )

  const badPages: Array<[string, string]> = [
    ['page=0', 'нулевая страница'],
    ['page=-1', 'отрицательная страница'],
    ['pageSize=0', 'нулевой размер страницы'],
    ['pageSize=1000000', 'огромный размер страницы'],
    ['page=abc', 'нечисловая страница'],
    ['page=1.5', 'дробная страница'],
  ]
  for (const [param, label] of badPages) {
    const result = await call('GET', `/api/universities?${param}`)
    check(`${label} отклоняется`, result.status === 422, `статус ${result.status}`)
  }

  const unknownField = await call<{ name: string }>('POST', '/api/universities', {
    name: `Вуз с лишним полем ${Date.now().toString().slice(-6)}`,
    city: 'Москва',
    region: 'Москва',
    isAdmin: true,
    passwordHash: 'взлом',
  })
  check(
    'неизвестные поля отбрасываются, а не сохраняются',
    unknownField.status === 201 && !('passwordHash' in (unknownField.body.data ?? {})),
    `статус ${unknownField.status}`,
  )

  const notFoundIds = [
    '/api/universities/00000000000000000000000000',
    '/api/programs/not-a-real-id',
    '/api/cooperations/%20',
    '/api/documents/..%2F..%2Fetc%2Fpasswd',
  ]
  for (const path of notFoundIds) {
    const result = await call('GET', path)
    check(
      `несуществующий идентификатор даёт 404 или 422: ${path.slice(0, 40)}`,
      result.status === 404 || result.status === 422,
      `статус ${result.status}`,
    )
  }
}

async function checkDoubleClick(ctx: ProbeContext): Promise<void> {
  step('3а. Двойной клик не должен ломать данные')
  const { managerId } = ctx

  const generations = await Promise.all([
    call('POST', '/api/recommendations/generate'),
    call('POST', '/api/recommendations/generate'),
    call('POST', '/api/recommendations/generate'),
  ])
  check(
    'одновременная генерация рекомендаций проходит без ошибок',
    generations.every((result) => result.status === 200),
    `статусы ${generations.map((result) => result.status).join(', ')}`,
  )

  if (managerId) {
    const sfx = Date.now().toString().slice(-6)
    const uni = await call<{ id: string }>('POST', '/api/universities', {
      name: `Пробный вуз гонки ${sfx}`,
      city: 'Тверь',
      region: 'Тверская область',
    })
    const program = await call<{ id: string }>('POST', '/api/programs', {
      universityId: uni.body.data?.id,
      name: `Пробная программа гонки ${sfx}`,
      level: 'BACHELOR',
    })
    const raceCooperation = await call<{
      id: string
      stages: Array<{ id: string; tasks: Array<{ id: string; isRequired: boolean }> }>
    }>('POST', '/api/cooperations', {
      universityId: uni.body.data?.id,
      programId: program.body.data?.id,
      responsibleId: managerId,
    })

    const raceStage = raceCooperation.body.data?.stages[0]
    if (raceStage) {
      await call('PATCH', `/api/workflow/stages/${raceStage.id}`, { status: 'IN_PROGRESS' })
      for (const task of raceStage.tasks.filter((item) => item.isRequired)) {
        await call('PATCH', `/api/workflow/tasks/${task.id}`, { isDone: true })
      }

      const doubleClick = await Promise.all([
        call('PATCH', `/api/workflow/stages/${raceStage.id}`, {
          status: 'COMPLETED',
          result: 'Готово',
        }),
        call('PATCH', `/api/workflow/stages/${raceStage.id}`, {
          status: 'COMPLETED',
          result: 'Готово',
        }),
      ])
      check(
        'двойное завершение этапа: ровно одно проходит',
        doubleClick.filter((result) => result.status === 200).length === 1,
        `статусы ${doubleClick.map((result) => result.status).join(', ')}`,
      )

      const history = await call<Array<{ toStatus: string }>>(
        'GET',
        `/api/workflow/stages/${raceStage.id}/history`,
      )
      const completions = (history.body.data ?? []).filter((item) => item.toStatus === 'COMPLETED')
      check(
        'в истории нет дубля о завершении',
        completions.length === 1,
        `${completions.length} записей`,
      )
    }
  }
}

async function checkErrorContract(): Promise<void> {
  step('4. Любая ошибка соответствует контракту')

  const errorSamples = [
    await call('GET', '/api/universities/no-such-id'),
    await call('POST', '/api/universities', {}),
    await call('GET', '/api/universities?pageSize=0'),
  ]
  for (const sample of errorSamples) {
    const error = sample.body.error
    check(
      `ошибка ${sample.status}: есть code и сообщение на русском`,
      Boolean(error?.code) && /[а-яА-Я]/.test(error?.message ?? ''),
      error?.message ?? '(нет тела)',
    )
  }

  const internalLeak = errorSamples.every(
    (sample) => !sample.raw.includes('prisma') && !sample.raw.includes('at Object'),
  )
  check('во внешних ошибках нет внутренних подробностей', internalLeak)
}

async function checkAuditAdminOnly(ctx: ProbeContext): Promise<void> {
  step('5. Журнал действий закрыт от всех, кроме администратора')
  const { adminId } = ctx

  const auditAsManager = await call('GET', '/api/audit')
  check('менеджеру журнал закрыт', auditAsManager.status === 403, `статус ${auditAsManager.status}`)

  if (adminId) {
    actAs(adminId)
    const auditAsAdmin = await call<unknown[]>('GET', '/api/audit?pageSize=5')
    check('администратору журнал открыт', auditAsAdmin.status === 200)
    actAs(null)
  }
}

async function checkConcurrentStageChanges(ctx: ProbeContext): Promise<void> {
  step('Одновременные изменения этапов одной связки не ломают этап 14')
  const { managerId } = ctx

  if (managerId) {
    const sfx = Date.now().toString().slice(-6)
    const uni = await call<{ id: string }>('POST', '/api/universities', {
      name: `Пробный вуз очереди ${sfx}`,
      city: 'Тверь',
      region: 'Тверская область',
    })

    // Этапы 1–13 закрываются одновременно — как если бы их закрывали несколько
    // человек разом. Без очереди каждая транзакция видит чужие этапы ещё
    // открытыми, и этап 14 остался бы «в работе» при закрытых 1–13.
    // У каждого раунда своя программа: вторая незакрытая связка на ту же
    // «вуз + программа + продукт» запрещена (решение 80).
    const finals: string[] = []
    for (let round = 0; round < 3; round += 1) {
      const program = await call<{ id: string }>('POST', '/api/programs', {
        universityId: uni.body.data?.id,
        name: `Пробная программа очереди ${sfx}-${round + 1}`,
        level: 'BACHELOR',
      })
      const created = await call<{ id: string; stages: Array<{ id: string; stageNumber: number }> }>(
        'POST',
        '/api/cooperations',
        { universityId: uni.body.data?.id, programId: program.body.data?.id, responsibleId: managerId },
      )
      const stages = created.body.data?.stages ?? []
      const byNumber = (n: number) => stages.find((stage) => stage.stageNumber === n)?.id
      await Promise.all(
        Array.from({ length: 13 }, (_, index) => index + 1).map((n) =>
          call('PATCH', `/api/workflow/stages/${byNumber(n)}`, {
            status: 'CANCELLED',
            comment: 'Пробник: не требуется',
          }),
        ),
      )
      const after = await call<{ stages: Array<{ stageNumber: number; status: string }> }>(
        'GET',
        `/api/cooperations/${created.body.data?.id}`,
      )
      finals.push(after.body.data?.stages.find((stage) => stage.stageNumber === 14)?.status ?? '—')
    }
    check(
      'закрыты все 1–13 одновременно — этап 14 завершён',
      finals.every((status) => status === 'COMPLETED'),
      `этап 14: ${finals.join(', ')}`,
    )
  }
}

async function checkStageKeepsResultAndReason(ctx: ProbeContext): Promise<void> {
  step('Завершённый этап не теряет результат, заблокированный — причину')
  const { managerId } = ctx

  if (managerId) {
    const sfx = Date.now().toString().slice(-6)
    const uni = await call<{ id: string }>('POST', '/api/universities', {
      name: `Пробный вуз итога ${sfx}`,
      city: 'Тверь',
      region: 'Тверская область',
    })
    const program = await call<{ id: string }>('POST', '/api/programs', {
      universityId: uni.body.data?.id,
      name: `Пробная программа итога ${sfx}`,
      level: 'BACHELOR',
    })
    const created = await call<{
      stages: Array<{ id: string; stageNumber: number; tasks: Array<{ id: string; isRequired: boolean }> }>
    }>('POST', '/api/cooperations', {
      universityId: uni.body.data?.id,
      programId: program.body.data?.id,
      responsibleId: managerId,
    })
    const first = created.body.data?.stages.find((stage) => stage.stageNumber === 1)
    const second = created.body.data?.stages.find((stage) => stage.stageNumber === 2)
    if (first && second) {
      await call('PATCH', `/api/workflow/stages/${first.id}`, { status: 'IN_PROGRESS' })
      for (const task of first.tasks.filter((item) => item.isRequired)) {
        await call('PATCH', `/api/workflow/tasks/${task.id}`, { isDone: true })
      }
      await call('PATCH', `/api/workflow/stages/${first.id}`, { result: 'Контакт найден' })
      const completedWithBlank = await call<{ result: string | null }>(
        'PATCH',
        `/api/workflow/stages/${first.id}`,
        { status: 'COMPLETED', result: '   ' },
      )
      check(
        'завершение с пустым результатом в теле сохраняет прежний',
        completedWithBlank.status === 200 && completedWithBlank.body.data?.result === 'Контакт найден',
        `код ${completedWithBlank.status}, результат ${JSON.stringify(completedWithBlank.body.data?.result)}`,
      )
      const erased = await call('PATCH', `/api/workflow/stages/${first.id}`, { result: null })
      check('результат завершённого этапа не стирается', erased.status === 422, `код ${erased.status}`)

      await call('PATCH', `/api/workflow/stages/${second.id}`, { status: 'IN_PROGRESS' })
      await call('PATCH', `/api/workflow/stages/${second.id}`, {
        status: 'BLOCKED',
        blockingReason: 'Пробник: ждём ответа',
      })
      const noReason = await call('PATCH', `/api/workflow/stages/${second.id}`, { blockingReason: '' })
      check('причина блокировки не стирается', noReason.status === 422, `код ${noReason.status}`)

      // История хранит причину и результат: на этапе причина стирается
      // при снятии блокировки, и узнать её потом можно только из истории.
      const unblocked = await call('PATCH', `/api/workflow/stages/${second.id}`, {
        status: 'IN_PROGRESS',
        comment: 'Пробник: ответ получен',
      })
      type HistoryEntry = { fromStatus: string | null; toStatus: string; comment: string | null }
      const secondHistory = await call<HistoryEntry[]>(
        'GET',
        `/api/workflow/stages/${second.id}/history`,
      )
      const entries = secondHistory.body.data ?? []
      const blockEntry = entries.find((entry) => entry.toStatus === 'BLOCKED')
      const unblockEntry = entries.find(
        (entry) => entry.fromStatus === 'BLOCKED' && entry.toStatus === 'IN_PROGRESS',
      )
      check(
        'история блокировки хранит причину',
        blockEntry?.comment === 'Пробник: ждём ответа',
        `запись: ${JSON.stringify(blockEntry?.comment)}`,
      )
      check(
        'снятие блокировки пишет в историю «что изменилось»',
        unblocked.status === 200 && unblockEntry?.comment === 'Пробник: ответ получен',
        `код ${unblocked.status}, запись: ${JSON.stringify(unblockEntry?.comment)}`,
      )
      const firstHistory = await call<HistoryEntry[]>('GET', `/api/workflow/stages/${first.id}/history`)
      const completeEntry = (firstHistory.body.data ?? []).find((entry) => entry.toStatus === 'COMPLETED')
      check(
        'история завершения хранит результат',
        completeEntry?.comment === 'Контакт найден',
        `запись: ${JSON.stringify(completeEntry?.comment)}`,
      )
    } else {
      check('связка для проверки итога создана', false)
    }
  }
}

async function checkRecommendationReopens(ctx: ProbeContext): Promise<void> {
  step('Рекомендация, закрытая системой, открывается, когда проблема вернулась')
  const { managerId } = ctx

  if (managerId) {
    const sfx = Date.now().toString().slice(-6)
    const uni = await call<{ id: string }>('POST', '/api/universities', {
      name: `Пробный вуз возврата ${sfx}`,
      city: 'Тверь',
      region: 'Тверская область',
    })
    const program = await call<{ id: string }>('POST', '/api/programs', {
      universityId: uni.body.data?.id,
      name: `Пробная программа возврата ${sfx}`,
      level: 'BACHELOR',
    })
    const created = await call<{ id: string; stages: Array<{ id: string; stageNumber: number }> }>(
      'POST',
      '/api/cooperations',
      { universityId: uni.body.data?.id, programId: program.body.data?.id, responsibleId: managerId },
    )
    const cooperationId = created.body.data?.id
    const stage1 = created.body.data?.stages.find((stage) => stage.stageNumber === 1)
    const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()
    const overdueRecommendation = async () => {
      await call('POST', '/api/recommendations/generate')
      const list = await call<Array<{ ruleKey: string; status: string; title: string }>>(
        'GET',
        `/api/recommendations?cooperationId=${cooperationId}&pageSize=50`,
      )
      return (list.body.data ?? []).find((row) => row.ruleKey === 'stage.overdue')
    }

    if (cooperationId && stage1) {
      await call('PATCH', `/api/workflow/stages/${stage1.id}`, { status: 'IN_PROGRESS', deadline: daysFromNow(-5) })
      const first = await overdueRecommendation()
      check('просрочка дала рекомендацию', first?.status === 'NEW', `статус ${first?.status ?? 'нет'}`)

      // Срок перенесли — просрочки нет, система закрывает рекомендацию сама.
      await call('PATCH', `/api/workflow/stages/${stage1.id}`, { deadline: daysFromNow(30) })
      const solved = await overdueRecommendation()
      check('проблема ушла — рекомендация закрыта системой', solved?.status === 'DONE', `статус ${solved?.status ?? 'нет'}`)

      // Срок снова в прошлом — та же проблема вернулась.
      await call('PATCH', `/api/workflow/stages/${stage1.id}`, { deadline: daysFromNow(-5) })
      const back = await overdueRecommendation()
      check(
        'вернулась — рекомендация снова открыта, а не «выполнена»',
        back?.status === 'NEW',
        `статус ${back?.status ?? 'нет'}`,
      )
    } else {
      check('связка для проверки возврата создана', false)
    }
  }
}

async function checkOverdueRecommendationTransitions(ctx: ProbeContext): Promise<void> {
  step('Рекомендацию о просрочке не закрыть, пока просрочка есть; переходы проверяет сервер')
  const { managerId } = ctx

  if (managerId) {
    // Свои записи: демонстрационные рекомендации не трогаются.
    const sfx = Date.now().toString().slice(-6)
    const uni = await call<{ id: string }>('POST', '/api/universities', {
      name: `Пробный вуз честной просрочки ${sfx}`,
      city: 'Тверь',
      region: 'Тверская область',
    })
    type Rec = { id: string; ruleKey: string; status: string }
    const makeOverdue = async (label: string) => {
      const program = await call<{ id: string }>('POST', '/api/programs', {
        universityId: uni.body.data?.id,
        name: `Пробная программа ${label} ${sfx}`,
        level: 'BACHELOR',
      })
      const created = await call<{ id: string; stages: Array<{ id: string; stageNumber: number }> }>(
        'POST',
        '/api/cooperations',
        { universityId: uni.body.data?.id, programId: program.body.data?.id, responsibleId: managerId },
      )
      const cooperationId = created.body.data?.id
      const stage1 = created.body.data?.stages.find((stage) => stage.stageNumber === 1)
      if (!cooperationId || !stage1) return null
      await call('PATCH', `/api/workflow/stages/${stage1.id}`, {
        status: 'IN_PROGRESS',
        deadline: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      })
      await call('POST', '/api/recommendations/generate')
      const list = await call<Rec[]>('GET', `/api/recommendations?cooperationId=${cooperationId}&pageSize=50`)
      const rec = (list.body.data ?? []).find((row) => row.ruleKey === 'stage.overdue')
      return rec ? { cooperationId, stageId: stage1.id, rec } : null
    }
    const statusOf = async (id: string) =>
      (await call<Rec>('GET', `/api/recommendations/${id}`)).body.data?.status ?? 'нет'

    const first = await makeOverdue('закрытия')
    if (first) {
      const skip = await call<Rec>('PATCH', `/api/recommendations/${first.rec.id}`, { status: 'DONE' })
      check(
        'недопустимый переход «Новая → Закрыта» — 409 INVALID_TRANSITION',
        skip.status === 409 && skip.body.error?.code === 'INVALID_TRANSITION',
        `код ${skip.status} ${skip.body.error?.code ?? ''}`,
      )

      await call('PATCH', `/api/recommendations/${first.rec.id}`, { status: 'IN_PROGRESS' })
      const close = await call<Rec>('PATCH', `/api/recommendations/${first.rec.id}`, { status: 'DONE' })
      check(
        'закрыть просроченную рекомендацию, пока этап просрочен, — 409',
        close.status === 409 && close.body.error?.code === 'CONFLICT',
        `код ${close.status} ${close.body.error?.code ?? ''}`,
      )
      check(
        'отказ говорит, сколько дней просрочки и что делать',
        /просрочен на 5 дн\..*отклонить с основанием/.test(close.body.error?.message ?? ''),
        close.body.error?.message ?? '',
      )
      check('рекомендация осталась в работе', (await statusOf(first.rec.id)) === 'IN_PROGRESS')

      // Этап отменили — просрочки нет: рекомендация закрывается сразу, без пересборки.
      await call('PATCH', `/api/workflow/stages/${first.stageId}`, {
        status: 'CANCELLED',
        comment: 'Не требуется для этой связки',
      })
      check(
        'этап отменён — рекомендация о его просрочке закрыта системой',
        (await statusOf(first.rec.id)) === 'DONE',
        `статус ${await statusOf(first.rec.id)}`,
      )
      const reopenByHand = await call('PATCH', `/api/recommendations/${first.rec.id}`, { status: 'NEW' })
      check(
        'закрытую руками в новые не вернуть — 409 INVALID_TRANSITION',
        reopenByHand.status === 409 && reopenByHand.body.error?.code === 'INVALID_TRANSITION',
      )
    } else {
      check('рекомендация о просрочке для проверки закрытия создана', false)
    }

    const dismissed = await makeOverdue('отклонения')
    if (dismissed) {
      await call('PATCH', `/api/recommendations/${dismissed.rec.id}`, {
        status: 'DISMISSED',
        comment: 'Срок согласован с вузом устно',
      })
      await call('POST', '/api/recommendations/generate')
      check(
        'отклонённую с основанием пересборка не трогает',
        (await statusOf(dismissed.rec.id)) === 'DISMISSED',
        `статус ${await statusOf(dismissed.rec.id)}`,
      )
    } else {
      check('рекомендация о просрочке для проверки отклонения создана', false)
    }
  }
}

async function checkCrossUniversityLinks(ctx: ProbeContext): Promise<void> {
  step('Встреча и документ не связывают разные вузы, счётчики представителю — свои')
  const { rep, adminId, foreignUniversity, managerId } = ctx

  if (managerId && rep && foreignUniversity) {
    const sfx = Date.now().toString().slice(-6)
    const foreignProgram = await call<{ id: string }>('POST', '/api/programs', {
      universityId: foreignUniversity.id,
      name: `Пробная чужая программа ${sfx}`,
      level: 'BACHELOR',
    })
    const foreignContactUniversity = await call<{ id: string; contacts: Array<{ id: string }> }>(
      'POST',
      '/api/universities',
      {
        name: `Пробный вуз с контактом ${sfx}`,
        city: 'Тверь',
        region: 'Тверская область',
        contacts: [{ fullName: 'Пробник Контакт Чужой', position: 'Проректор' }],
      },
    )
    const foreignContactId = foreignContactUniversity.body.data?.contacts?.[0]?.id

    // Привязки проверяются вместе, а не каждая сама по себе: иначе такая встреча
    // показала бы представителю вуза чужую программу и ФИО чужого контакта.
    const mixedMeeting = await call('POST', '/api/meetings', {
      universityId: rep.universityId,
      programId: foreignProgram.body.data?.id,
      date: new Date().toISOString(),
      topic: 'Пробник: встреча с чужой программой',
      responsibleId: managerId,
    })
    check('встреча с программой другого вуза отклоняется', mixedMeeting.status === 422, `код ${mixedMeeting.status}`)

    const foreignParticipant = await call('POST', '/api/meetings', {
      universityId: rep.universityId,
      date: new Date().toISOString(),
      topic: 'Пробник: встреча с чужим контактом',
      responsibleId: managerId,
      participants: [{ contactId: foreignContactId }],
    })
    check(
      'контактное лицо другого вуза в участниках отклоняется',
      foreignContactId !== undefined && foreignParticipant.status === 422,
      `код ${foreignParticipant.status}`,
    )

    const repResponsible = await call('POST', '/api/meetings', {
      universityId: rep.universityId,
      date: new Date().toISOString(),
      topic: 'Пробник: представитель ответственным',
      responsibleId: rep.id,
    })
    check('ответственный — только сотрудник ИТ-Школы', repResponsible.status === 422, `код ${repResponsible.status}`)

    // Аналитик — сотрудник, но изменять записи не может, и ответственным его не назначить.
    const analysts = await call<Array<{ id: string }>>('GET', '/api/users?role=ANALYST&pageSize=1')
    const analystId = analysts.body.data?.[0]?.id
    const analystResponsible = analystId
      ? await call('POST', '/api/meetings', {
          universityId: rep.universityId,
          date: new Date().toISOString(),
          topic: 'Пробник: аналитик ответственным',
          responsibleId: analystId,
        })
      : null
    check(
      'ответственный — менеджер или администратор, не аналитик',
      analystResponsible?.status === 422,
      analystId ? `код ${analystResponsible?.status}` : 'нет аналитика: нужен npm run db:seed',
    )

    const mixedDocument = await call('POST', '/api/documents', {
      type: 'AGREEMENT',
      title: 'Пробник: документ с чужой программой',
      universityId: rep.universityId,
      programId: foreignProgram.body.data?.id,
    })
    check('документ с программой другого вуза отклоняется', mixedDocument.status === 422, `код ${mixedDocument.status}`)

    // Счётчики: у представителя — только связки и программы своего вуза.
    const staffProducts = await call<Array<{ id: string; cooperationCount: number }>>('GET', '/api/products?pageSize=100')
    const ownCooperations = await call<Array<{ productId: string | null }>>(
      'GET',
      `/api/cooperations?universityId=${rep.universityId}&pageSize=100`,
    )
    actAs(rep.id)
    const repProducts = await call<Array<{ id: string; cooperationCount: number }>>('GET', '/api/products?pageSize=100')
    actAs(null)
    const ownByProduct = new Map<string, number>()
    for (const row of ownCooperations.body.data ?? []) {
      if (row.productId) ownByProduct.set(row.productId, (ownByProduct.get(row.productId) ?? 0) + 1)
    }
    const leaked = (repProducts.body.data ?? []).filter(
      (row) => row.cooperationCount !== (ownByProduct.get(row.id) ?? 0),
    )
    check(
      'у представителя число связок продукта — только своего вуза',
      repProducts.status === 200 && leaked.length === 0,
      `расхождений ${leaked.length}; у сотрудника всего ${(staffProducts.body.data ?? []).reduce((sum, row) => sum + row.cooperationCount, 0)}`,
    )

    // Журнал: создание вуза обещано в SECURITY_LIMITATIONS.
    if (adminId) {
      actAs(adminId)
      const logged = await call<Array<{ action: string }>>(
        'GET',
        `/api/audit?objectType=University&objectId=${foreignContactUniversity.body.data?.id}`,
      )
      actAs(null)
      check(
        'создание вуза записано в журнал',
        (logged.body.data ?? []).some((row) => row.action === 'university.create'),
        `записей ${(logged.body.data ?? []).length}`,
      )
    }
  }
}

async function checkDocumentDoubleSubmit(ctx: ProbeContext): Promise<void> {
  step('Документы: двойное нажатие не плодит версий и пакетов, подписывают не пустое')
  const { managerId } = ctx

  if (managerId) {
    const sfx = Date.now().toString().slice(-6)
    const uni = await call<{ id: string }>('POST', '/api/universities', {
      name: `Пробный вуз документов ${sfx}`,
      city: 'Тверь',
      region: 'Тверская область',
    })
    const program = await call<{ id: string }>('POST', '/api/programs', {
      universityId: uni.body.data?.id,
      name: `Пробная программа документов ${sfx}`,
      level: 'BACHELOR',
    })
    const created = await call<{ id: string }>('POST', '/api/cooperations', {
      universityId: uni.body.data?.id,
      programId: program.body.data?.id,
      responsibleId: managerId,
    })
    const cooperationId = created.body.data?.id

    // Новая версия двумя одновременными запросами — одна версия, а не две «версии 2».
    const original = await call<{ id: string }>('POST', '/api/documents', {
      type: 'AGREEMENT',
      title: `Пробный договор ${sfx}`,
      cooperationId,
      fileReference: 'https://example.invalid/probe.pdf',
    })
    const originalId = original.body.data?.id
    const versions = await Promise.all([
      call<{ id: string }>('POST', `/api/documents/${originalId}/versions`),
      call<{ id: string }>('POST', `/api/documents/${originalId}/versions`),
    ])
    const list = await call<Array<{ title: string; version: string }>>(
      'GET',
      `/api/documents?cooperationId=${cooperationId}&pageSize=50`,
    )
    const secondVersions = (list.body.data ?? []).filter(
      (row) => row.title === `Пробный договор ${sfx}` && row.version === '2',
    )
    check(
      'двойное «Новая версия» — одна версия 2',
      secondVersions.length === 1,
      `версий 2: ${secondVersions.length}; коды ${versions.map((result) => result.status).join(', ')}`,
    )
    const fromArchived = await call('POST', `/api/documents/${originalId}/versions`)
    check('от архивной версии новая не создаётся', fromArchived.status === 409, `код ${fromArchived.status}`)

    // Пакет двумя одновременными запросами — один комплект.
    await Promise.all([
      call('POST', `/api/cooperations/${cooperationId}/documents/generate`),
      call('POST', `/api/cooperations/${cooperationId}/documents/generate`),
    ])
    const afterPackage = await call<Array<{ templateKey: string | null }>>(
      'GET',
      `/api/documents?cooperationId=${cooperationId}&pageSize=100`,
    )
    const keys = (afterPackage.body.data ?? []).flatMap((row) => (row.templateKey ? [row.templateKey] : []))
    check(
      'двойное «Собрать пакет» — один комплект',
      keys.length > 0 && new Set(keys).size === keys.length,
      `документов по шаблонам ${keys.length}, разных ${new Set(keys).size}`,
    )

    // Ещё одно нажатие — ни одного нового документа. Договор здесь заведён вручную
    // (и выпущен новой версией), продукт у связки не выбран: пакет не должен ни
    // добавить второй договор, ни собрать «Лицензию на IT-продукт «______»».
    const again = await call<{
      created: unknown[]
      skipped: Array<{ templateKey: string; templateName: string; reason: string }>
    }>('POST', `/api/cooperations/${cooperationId}/documents/generate`)
    const skippedReason = (key: string) =>
      again.body.data?.skipped.find((item) => item.templateKey === key)?.reason ?? ''
    check(
      'повторный «Собрать пакет» не создаёт документов',
      again.status === 200 && (again.body.data?.created.length ?? -1) === 0,
      `создано ${again.body.data?.created.length ?? '—'}, код ${again.status}`,
    )
    check(
      'договор, заведённый вручную, пакет не дублирует',
      !keys.includes('agreement') && skippedReason('agreement').startsWith('уже есть:'),
      skippedReason('agreement'),
    )
    check(
      'лицензия без выбранного продукта не собирается',
      !keys.includes('license') && skippedReason('license').includes('не выбран IT-продукт'),
      skippedReason('license'),
    )
    check(
      'пропущенные шаблоны названы по-русски, не ключами',
      (again.body.data?.skipped ?? []).every((item) => /[а-яА-Я]/.test(item.templateName)),
    )

    // Утверждённый документ без текста: ссылку не стереть, пустой не подписать.
    const approved = await call<{ id: string }>('POST', '/api/documents', {
      type: 'AGREEMENT',
      title: `Пробный утверждаемый ${sfx}`,
      cooperationId,
      fileReference: 'https://example.invalid/approve.pdf',
    })
    const approvedId = approved.body.data?.id
    await call('PATCH', `/api/documents/${approvedId}/status`, { status: 'REVIEW' })
    await call('PATCH', `/api/documents/${approvedId}/status`, { status: 'APPROVED' })
    const erased = await call('PATCH', `/api/documents/${approvedId}`, { fileReference: null })
    check('у утверждённого документа ссылку не стереть', erased.status === 422, `код ${erased.status}`)

    // Связка: закрытой не создаётся, несуществующий продукт — не «связка не найдена».
    const closedAtBirth = await call('POST', '/api/cooperations', {
      universityId: uni.body.data?.id,
      programId: program.body.data?.id,
      responsibleId: managerId,
      status: 'COMPLETED',
    })
    check('связка не создаётся сразу закрытой', closedAtBirth.status === 422, `код ${closedAtBirth.status}`)
    const badProduct = await call('PATCH', `/api/cooperations/${cooperationId}`, { productId: 'нет-такого' })
    check(
      'несуществующий продукт — ошибка поля, а не «связка не найдена»',
      badProduct.status === 422,
      `код ${badProduct.status}`,
    )

    // Вторая незакрытая связка на те же «вуз + программа + продукт» (продукт не выбран —
    // тоже значение) — 409 со ссылкой на существующую.
    const duplicate = await call('POST', '/api/cooperations', {
      universityId: uni.body.data?.id,
      programId: program.body.data?.id,
      responsibleId: managerId,
    })
    check(
      'дубль незакрытой связки — 409 со ссылкой на существующую',
      duplicate.status === 409 &&
        (duplicate.body.error?.details as { cooperationId?: string } | undefined)?.cooperationId ===
          cooperationId,
      `код ${duplicate.status}: ${duplicate.body.error?.message ?? ''}`,
    )

    // Закрытая связка новой не мешает: сотрудничество можно начать заново.
    await call('PATCH', `/api/cooperations/${cooperationId}`, { status: 'CANCELLED' })
    const afterClosed = await call<{ id: string }>('POST', '/api/cooperations', {
      universityId: uni.body.data?.id,
      programId: program.body.data?.id,
      responsibleId: managerId,
    })
    check('после закрытия прежней связка заводится заново', afterClosed.status === 201, `код ${afterClosed.status}`)

    // И переоткрыть прежнюю, пока открыта новая такая же, нельзя.
    const reopenDuplicate = await call('PATCH', `/api/cooperations/${cooperationId}`, { status: 'ACTIVE' })
    check('переоткрытие в дубль — 409', reopenDuplicate.status === 409, `код ${reopenDuplicate.status}`)

    // Двойное «Создать связку» — одна связка, второй запрос получает 409.
    const raceProgram = await call<{ id: string }>('POST', '/api/programs', {
      universityId: uni.body.data?.id,
      name: `Пробная программа двойного создания ${sfx}`,
      level: 'BACHELOR',
    })
    const doubleCreate = await Promise.all(
      [0, 1].map(() =>
        call('POST', '/api/cooperations', {
          universityId: uni.body.data?.id,
          programId: raceProgram.body.data?.id,
          responsibleId: managerId,
        }),
      ),
    )
    const createStatuses = doubleCreate.map((result) => result.status).sort()
    check(
      'двойное «Создать связку» — одна связка',
      createStatuses.join(',') === '201,409',
      `коды ${createStatuses.join(', ')}`,
    )
  }
}

async function checkArchivedUniversityNotRated(): Promise<void> {
  step('Программы архивного вуза не попадают в рейтинг')

  const sfx = Date.now().toString().slice(-6)
  const uni = await call<{ id: string }>('POST', '/api/universities', {
    name: `Пробный архивный вуз ${sfx}`,
    city: 'Тверь',
    region: 'Тверская область',
  })
  const program = await call<{ id: string }>('POST', '/api/programs', {
    universityId: uni.body.data?.id,
    name: `Пробная программа архивного вуза ${sfx}`,
    level: 'BACHELOR',
    applicationCount: 999_999,
    studentCount: 999_999,
    groupCount: 999,
  })
  const inRating = async () => {
    const rating = await call<Array<{ programId: string }>>('GET', '/api/analytics/programs?limit=100')
    return (rating.body.data ?? []).some((row) => row.programId === program.body.data?.id)
  }
  check('программа действующего вуза в рейтинге', await inRating())
  await call('POST', `/api/universities/${uni.body.data?.id}/archive`)
  // Программа архивного вуза не должна оставаться «действующей» и сдвигать шкалу рейтинга.
  check('после архивации вуза — нет', !(await inRating()))
}

async function checkProductCrud(ctx: ProbeContext): Promise<void> {
  step('IT-продукт: создание, дубль 409, правка, права')
  const { adminId, managerId } = ctx

  type ProductCard = {
    id: string
    name: string
    category: string
    status: string
    version: string | null
    description: string | null
    documentationUrl: string | null
    isMock: boolean
    skills: Array<{ skillId: string; relevance: string }>
  }
  const sfx = Date.now().toString().slice(-6)
  const name = `Пробный продукт ${sfx}`

  const created = await call<ProductCard>('POST', '/api/products', {
    name,
    category: 'Пробная категория',
    version: '1.0',
    documentationUrl: 'https://docs.example.invalid/probe',
  })
  const productId = created.body.data?.id
  check('продукт заводится: 201', created.status === 201, `статус ${created.status}`)
  check(
    'заведённый вручную продукт не демо, статус по умолчанию — действующий',
    created.body.data?.isMock === false && created.body.data?.status === 'ACTIVE',
  )

  const found = await call<Array<{ id: string }>>(
    'GET',
    `/api/products?q=${encodeURIComponent(name)}`,
  )
  check(
    'новый продукт виден в реестре',
    (found.body.data ?? []).some((row) => row.id === productId),
  )

  const duplicate = await call('POST', '/api/products', { name, category: 'Другая' })
  check(
    'дубль названия — 409 с понятным текстом',
    duplicate.status === 409 && (duplicate.body.error?.message ?? '').includes('уже есть'),
    `статус ${duplicate.status}: ${duplicate.body.error?.message ?? ''}`,
  )
  const duplicateCase = await call('POST', '/api/products', {
    name: name.toUpperCase(),
    category: 'Другая',
  })
  check('дубль в другом регистре — тоже 409', duplicateCase.status === 409, `статус ${duplicateCase.status}`)

  const scriptUrl = await call('POST', '/api/products', {
    name: `Пробный продукт со ссылкой ${sfx}`,
    category: 'Пробная категория',
    documentationUrl: 'javascript:alert(1)',
  })
  check('ссылка javascript: отклоняется — 422', scriptUrl.status === 422, `статус ${scriptUrl.status}`)

  if (productId) {
    const edited = await call<ProductCard>('PATCH', `/api/products/${productId}`, {
      status: 'DEPRECATED',
      description: 'Правка пробника',
    })
    check(
      'правка сохраняет только переданные поля',
      edited.status === 200 &&
        edited.body.data?.status === 'DEPRECATED' &&
        edited.body.data?.description === 'Правка пробника' &&
        edited.body.data?.version === '1.0' &&
        edited.body.data?.documentationUrl === 'https://docs.example.invalid/probe',
      `статус ${edited.status}`,
    )

    const empty = await call('PATCH', `/api/products/${productId}`, {})
    check('пустая правка — 422', empty.status === 422, `статус ${empty.status}`)

    const ownNameOtherCase = await call('PATCH', `/api/products/${productId}`, {
      name: name.toLowerCase(),
    })
    check(
      'своё название в другом регистре — не дубль',
      ownNameOtherCase.status === 200,
      `статус ${ownNameOtherCase.status}`,
    )

    const others = await call<Array<{ id: string; name: string }>>('GET', '/api/products?pageSize=5')
    const other = (others.body.data ?? []).find((row) => row.id !== productId)
    if (other) {
      const renamed = await call('PATCH', `/api/products/${productId}`, { name: other.name })
      check('переименование в чужое название — 409', renamed.status === 409, `статус ${renamed.status}`)
    }

    const freeVersion = await call<ProductCard>('PATCH', `/api/products/${productId}`, {
      version: '1.1',
    })
    check(
      'версию продукта без связок можно исправить',
      freeVersion.body.data?.version === '1.1',
      `статус ${freeVersion.status}`,
    )

    const skills = await call<Array<{ id: string }>>('GET', '/api/skills?pageSize=2')
    const skillIds = (skills.body.data ?? []).map((skill) => skill.id)
    const withSkills = await call<ProductCard>('PUT', `/api/products/${productId}/skills`, {
      skills: skillIds.map((skillId, index) => ({
        skillId,
        relevance: index === 0 ? 'CORE' : 'RELATED',
      })),
    })
    check(
      'навыки продукта заменяются набором',
      withSkills.status === 200 && withSkills.body.data?.skills.length === skillIds.length,
      `статус ${withSkills.status}`,
    )
    const repeated = await call('PUT', `/api/products/${productId}/skills`, {
      skills: [{ skillId: skillIds[0] }, { skillId: skillIds[0] }],
    })
    check('повтор навыка — 422', repeated.status === 422, `статус ${repeated.status}`)
    const unknownSkill = await call('PUT', `/api/products/${productId}/skills`, {
      skills: [{ skillId: 'no-such-skill' }],
    })
    check('несуществующий навык — 422', unknownSkill.status === 422, `статус ${unknownSkill.status}`)

    // Новый продукт выбирается в связке — ради этого его и заводят.
    if (managerId) {
      const uni = await call<{ id: string }>('POST', '/api/universities', {
        name: `Пробный вуз для продукта ${sfx}`,
        city: 'Тверь',
        region: 'Тверская область',
      })
      const program = await call<{ id: string }>('POST', '/api/programs', {
        universityId: uni.body.data?.id,
        name: `Пробная программа для продукта ${sfx}`,
        level: 'BACHELOR',
      })
      const cooperation = await call<{ productId: string | null }>('POST', '/api/cooperations', {
        universityId: uni.body.data?.id,
        programId: program.body.data?.id,
        productId,
        responsibleId: managerId,
        goal: 'Связка пробника с новым продуктом',
      })
      check(
        'новый продукт выбирается в связке',
        cooperation.status === 201 && cooperation.body.data?.productId === productId,
        `статус ${cooperation.status}`,
      )

      const lockedVersion = await call('PATCH', `/api/products/${productId}`, { version: '2.0' })
      check(
        'версию продукта с открытой связкой меняет выпуск версии, а не правка — 409',
        lockedVersion.status === 409,
        `статус ${lockedVersion.status}`,
      )
    }

    // Права — как у остальных справочников с записью.
    for (const role of ['UNIVERSITY_REP', 'VIEWER', 'ANALYST']) {
      const users = await call<Array<{ id: string }>>('GET', `/api/users?role=${role}`)
      const roleUserId = users.body.data?.[0]?.id
      if (!roleUserId) {
        check(`${role}: демо-пользователь есть`, false, 'запустите npm run db:seed')
        continue
      }
      actAs(roleUserId)
      const denied = [
        await call('POST', '/api/products', { name: `Чужой продукт ${sfx}`, category: 'Проба' }),
        await call('PATCH', `/api/products/${productId}`, { description: 'Не должно сохраниться' }),
        await call('PUT', `/api/products/${productId}/skills`, { skills: [] }),
      ]
      check(
        `${role}: заведение, правка и навыки продукта — 403`,
        denied.every((result) => result.status === 403),
        denied.map((result) => result.status).join(', '),
      )
      actAs(null)
    }

    if (adminId) {
      actAs(adminId)
      const journal = await call<Array<{ action: string }>>(
        'GET',
        `/api/audit?objectType=ITProduct&objectId=${productId}&pageSize=50`,
      )
      const actions = new Set((journal.body.data ?? []).map((row) => row.action))
      check(
        'заведение, правка и навыки продукта — в журнале',
        ['product.create', 'product.update', 'product.skills.replace'].every((action) =>
          actions.has(action),
        ),
        [...actions].join(', '),
      )
      actAs(null)
    }
  }
}

async function checkProgramImport(): Promise<void> {
  step('Импорт программ: отсутствующие колонки не стираются, повторы — ошибка строки')

  const sfx = Date.now().toString().slice(-6)
  const uniName = `Пробный вуз импорта ${sfx}`
  const programName = `Пробная программа импорта ${sfx}`
  const uni = await call<{ id: string }>('POST', '/api/universities', {
    name: uniName,
    city: 'Тверь',
    region: 'Тверская область',
  })
  const program = await call<{ id: string }>('POST', '/api/programs', {
    universityId: uni.body.data?.id,
    name: programName,
    level: 'BACHELOR',
    code: '09.03.04',
    applicationCount: 120,
    studentCount: 60,
    groupCount: 3,
  })
  // Файл только с обязательными колонками не должен стирать код и показатели.
  const csv = `Вуз;Программа;Уровень\r\n${uniName};${programName};BACHELOR\r\n${uniName};${programName};BACHELOR\r\n`
  const applied = await callRaw('POST', '/api/import?dataset=programs&mode=apply', csv, 'text/csv')
  const outcomes = (JSON.parse(applied.text) as { data?: { rows: Array<{ outcome: string }> } }).data?.rows.map(
    (row) => row.outcome,
  )
  // Первая строка совпадает с программой (тот же уровень, других колонок нет) —
  // «без изменений»; вторая — повтор первой.
  check('повтор строки в файле — ошибка, а не вторая программа', outcomes?.join() === 'unchanged,error', `исходы ${outcomes?.join()}`)
  const after = await call<{ code: string | null; applicationCount: { value: number | null } | number | null }>(
    'GET',
    `/api/programs/${program.body.data?.id}`,
  )
  const raw = JSON.stringify(after.body.data ?? {})
  check(
    'код и показатели программы на месте',
    raw.includes('09.03.04') && raw.includes('120'),
    after.status === 200 ? 'сверено по карточке программы' : `код ${after.status}`,
  )
}

async function checkRepDocumentHistory(ctx: ProbeContext): Promise<void> {
  step('Представитель не видит внутренних комментариев в истории документа')
  const { rep } = ctx

  if (rep) {
    // Причина отклонения — заметка сотрудников друг другу (решение 9): представителю
    // она не отдаётся ни в истории этапов и ленте событий, ни в истории документа.
    const note = `Пробник: внутренняя заметка ${Date.now()}`
    const created = await call<{ id: string }>('POST', '/api/documents', {
      type: 'AGREEMENT',
      title: 'Пробник: документ с внутренней заметкой',
      universityId: rep.universityId,
      fileReference: 'https://example.invalid/probe.pdf',
    })
    const documentId = created.body.data?.id
    if (documentId) {
      await call('PATCH', `/api/documents/${documentId}/status`, { status: 'REVIEW' })
      await call('PATCH', `/api/documents/${documentId}/status`, {
        status: 'REJECTED',
        comment: note,
      })

      const staffView = await call<{ history: Array<{ comment: string | null }> }>(
        'GET',
        `/api/documents/${documentId}`,
      )
      check(
        'сотрудник видит причину отклонения',
        (staffView.body.data?.history ?? []).some((entry) => entry.comment === note),
      )

      actAs(rep.id)
      const repView = await call<{ history: Array<{ comment: string | null }> }>(
        'GET',
        `/api/documents/${documentId}`,
      )
      check('представитель документ своего вуза открывает', repView.status === 200)
      check(
        'но комментариев в истории не получает',
        (repView.body.data?.history ?? []).length > 0 &&
          (repView.body.data?.history ?? []).every((entry) => entry.comment === null),
      )
      actAs(null)
    } else {
      check('документ для проверки создан', false)
    }
  }
}

async function checkUniversityRatingPrivacy(ctx: ProbeContext): Promise<void> {
  step('Рейтинг вуза не раскрывает чужие данные')
  const { rep } = ctx

  if (rep) {
    actAs(rep.id)

    // Рейтинг — аналитика. Представителю вуза закрыт не только сам показатель,
    // но и любые производные от него: по фильтру и порядку сортировки можно было бы
    // восстановить баллы чужих вузов, ни разу их не увидев.
    for (const [query, title] of [
      ['withRating=true', 'запрос рейтинга'],
      ['minRating=10', 'фильтр по нижней границе'],
      ['maxRating=90', 'фильтр по верхней границе'],
      ['sort=-rating', 'сортировка по рейтингу'],
      ['sort=rating', 'сортировка по рейтингу по возрастанию'],
    ] as const) {
      const response = await call(`GET`, `/api/universities?${query}`)
      check(`представителю вуза закрыт ${title}`, response.status === 403)
    }

    const plainList = await call<Array<{ rating: unknown }>>('GET', '/api/universities')
    check(
      'обычный список представителю по-прежнему доступен',
      plainList.status === 200,
    )
    check(
      'но рейтинга в нём нет',
      (plainList.body.data ?? []).every((row) => row.rating === null),
    )

    const ownCard = await call<{ rating: unknown }>(
      'GET',
      `/api/universities/${rep.universityId}`,
    )
    check(
      'в карточке своего вуза представителю рейтинг тоже не отдаётся',
      ownCard.status === 200 && ownCard.body.data?.rating === null,
    )

    actAs(null)
  }

  {
    // Пустой результат — это пустой результат, а не ошибка и не весь список.
    const impossibleRange = await call<unknown[]>(
      'GET',
      '/api/universities?minRating=100&maxRating=0',
    )
    check(
      'встречный диапазон не превращается в полный список',
      impossibleRange.status === 200 && (impossibleRange.body.data?.length ?? -1) === 0,
    )

    const meta = await call<unknown[]>('GET', '/api/universities?minRating=100&maxRating=0')
    check(
      'счётчик total при пустом отборе тоже ноль',
      ((meta.body as { meta?: { total?: number } }).meta?.total ?? -1) === 0,
    )

    for (const query of ['minRating=-1', 'maxRating=101', 'minRating=abc', 'sort=-ratings']) {
      const response = await call('GET', `/api/universities?${query}`)
      check(
        `кривой параметр ?${query} не роняет реестр`,
        response.status === 422 || response.status === 200,
      )
    }

    // Страница за пределами выборки не должна отдавать чужие строки.
    const farPage = await call<unknown[]>(
      'GET',
      '/api/universities?sort=-rating&page=500&pageSize=20',
    )
    check(
      'страница за пределами выборки пуста',
      farPage.status === 200 && (farPage.body.data?.length ?? -1) === 0,
    )

    // Сортировка по рейтингу считается в приложении, а не в SQL: страницу приходится
    // резать вручную. Обход по страницам обязан дать ровно то же, что одна выдача —
    // без потерь, без повторов, в том же порядке.
    const wholeList = await call<Array<{ id: string }>>(
      'GET',
      '/api/universities?pageSize=100&sort=-rating',
    )
    const expectedOrder = (wholeList.body.data ?? []).map((row) => row.id)

    // Одна выдача — не больше сотни (предел API). На рабочей базе, где пробник
    // заводит вузы при каждом прогоне, их больше, поэтому обход сверяется
    // с первыми строками выдачи, а не со всей базой.
    const collected: string[] = []
    for (let page = 1; page <= 40 && collected.length < expectedOrder.length; page += 1) {
      const chunk = await call<Array<{ id: string }>>(
        'GET',
        `/api/universities?pageSize=3&page=${page}&sort=-rating`,
      )
      const rows = chunk.body.data ?? []
      if (rows.length === 0) break
      collected.push(...rows.map((row) => row.id))
    }
    const walked = collected.slice(0, expectedOrder.length)

    check(
      'постраничный обход по рейтингу ничего не теряет',
      walked.length === expectedOrder.length,
      `собрано ${walked.length}, ожидалось ${expectedOrder.length}`,
    )
    check('постраничный обход не повторяет записи', new Set(collected).size === collected.length)
    check(
      'порядок при обходе по страницам совпадает с одной выдачей',
      walked.join(',') === expectedOrder.join(','),
    )

    // Отбор по рейтингу не должен ослаблять остальные фильтры.
    const withRegion = await call<Array<{ region: string; rating: { score: number | null } }>>(
      'GET',
      '/api/universities?pageSize=100&withRating=true&minRating=1&region=%D0%A1%D0%B0%D0%BD%D0%BA%D1%82-%D0%9F%D0%B5%D1%82%D0%B5%D1%80%D0%B1%D1%83%D1%80%D0%B3',
    )
    check(
      'фильтр по рейтингу не отменяет фильтр по региону',
      (withRegion.body.data ?? []).every(
        (row) => row.region === 'Санкт-Петербург' && row.rating.score !== null,
      ),
    )
  }
}

async function checkControlPoints(ctx: ProbeContext): Promise<void> {
  step('Контрольные точки нельзя обойти')
  const { rep, universities, managerId } = ctx

  {
    // Своя свежая связка: этапы до шестого не закрыты, контрольные точки не тронуты.
    // Чужую связку брать нельзя: раздел отменяет у неё этап 7 и вернуть не может
    // (отменённую контрольную точку не пускают обратно незакрытые этапы), а другой
    // раздел мог уже отменить его сам — проверка зависела бы от соседей.
    type ProbeStage = {
      id: string
      stageNumber: number
      status: string
      tasks: Array<{ id: string; isDone: boolean }>
    }
    let stages: ProbeStage[] = []
    const home = (universities.body.data ?? [])[0]
    if (home && managerId) {
      const sfx = Date.now().toString().slice(-6)
      const program = await call<{ id: string }>('POST', '/api/programs', {
        universityId: home.id,
        name: `Пробная программа контрольных точек ${sfx}`,
        level: 'BACHELOR',
      })
      const fresh = await call<{ stages: ProbeStage[] }>('POST', '/api/cooperations', {
        universityId: home.id,
        programId: program.body.data?.id,
        responsibleId: managerId,
      })
      stages = fresh.body.data?.stages ?? []
    }

    if (stages.length === 0) {
      check('пробная связка для контрольных точек создана', false, 'нужен npm run db:seed')
    } else {
      const find = (number: number) => stages.find((stage) => stage.stageNumber === number)

      const signing = find(6)
      const handover = find(7)
      const classes = find(11)

      for (const [stage, title] of [
        [signing, 'подписание документов'],
        [handover, 'передачу материалов и лицензии'],
        [classes, 'проведение занятий'],
      ] as const) {
        if (!stage) continue

        const started = await call('PATCH', `/api/workflow/stages/${stage.id}`, {
          status: 'IN_PROGRESS',
        })
        check(
          `нельзя начать ${title} раньше предыдущих этапов`,
          started.status === 409,
          `статус ${started.status}`,
        )

        const body = started.body as {
          error?: { details?: { blockingStages?: Array<{ stageNumber: number }> } }
        }
        const blocking = body.error?.details?.blockingStages ?? []
        check(
          `в отказе по «${title}» перечислены мешающие этапы`,
          blocking.length > 0 && blocking.every((item) => item.stageNumber < stage.stageNumber),
        )
      }

      // Пункт контрольной точки — то же утверждение о работе, что начало этапа
      // (решение 49): «Передана лицензия» до подписания договора не отмечается.
      // Проверяется до отмены ниже: у отменённого этапа пункты закрыты по другой
      // причине, и проверка прошла бы, ничего не доказав.
      const openTask = handover?.tasks.find((task) => !task.isDone)
      if (!openTask) {
        check('у пробной связки есть пункт этапа 7', false)
      } else {
        const ticked = await call('PATCH', `/api/workflow/tasks/${openTask.id}`, { isDone: true })
        const message = (ticked.body as { error?: { message?: string } }).error?.message ?? ''
        check(
          'пункт этапа 7 нельзя отметить раньше предыдущих этапов',
          ticked.status === 409 && message.includes('пункты нельзя отмечать'),
          `статус ${ticked.status}: ${message.slice(0, 60)}`,
        )
        if (ticked.status === 200) {
          await call('PATCH', `/api/workflow/tasks/${openTask.id}`, { isDone: false })
        }
      }

      // Шлагбаум: этапы за контрольной точкой ждут её завершения. Точка защищает
      // не только себя: этап 8 не начинается при неподписанном договоре, а отмена
      // этапа 6 с произвольным комментарием не открывает передачу лицензии.
      const support = find(8)
      if (support && signing) {
        type Refusal = {
          error?: { message?: string; details?: { blockingStages?: Array<{ stageNumber: number }> } }
        }
        const early = await call('PATCH', `/api/workflow/stages/${support.id}`, {
          status: 'IN_PROGRESS',
        })
        const earlyMessage = (early.body as Refusal).error?.message ?? ''
        check(
          'этап 8 нельзя начать, пока не завершены контрольные точки 6 и 7',
          early.status === 409 && earlyMessage.includes('идёт после контрольной точки'),
          `статус ${early.status}: ${earlyMessage.slice(0, 60)}`,
        )

        const supportTask = support.tasks.find((task) => !task.isDone)
        if (supportTask) {
          const ticked = await call('PATCH', `/api/workflow/tasks/${supportTask.id}`, {
            isDone: true,
          })
          check(
            'пункт этапа 8 нельзя отметить до завершения контрольных точек',
            ticked.status === 409,
            `статус ${ticked.status}`,
          )
          if (ticked.status === 200) {
            await call('PATCH', `/api/workflow/tasks/${supportTask.id}`, { isDone: false })
          }
        }

        const cancelledSigning = await call('PATCH', `/api/workflow/stages/${signing.id}`, {
          status: 'CANCELLED',
          comment: 'Пробник: отмена подписания не должна открывать следующие этапы',
        })
        const after = await call('PATCH', `/api/workflow/stages/${support.id}`, {
          status: 'IN_PROGRESS',
        })
        const stillBlocking = ((after.body as Refusal).error?.details?.blockingStages ?? []).map(
          (item) => item.stageNumber,
        )
        check(
          'отменённый этап 6 не открывает дорогу дальше',
          cancelledSigning.status === 200 && after.status === 409 && stillBlocking.includes(6),
          `отмена ${cancelledSigning.status}, этап 8 ${after.status}, мешают ${stillBlocking.join(', ')}`,
        )
      }

      // Отмена контрольной точки ничего не утверждает о работе — она разрешена.
      if (handover) {
        const cancelled = await call('PATCH', `/api/workflow/stages/${handover.id}`, {
          status: 'CANCELLED',
          comment: 'Пробник: проверка отмены контрольной точки',
        })
        check(
          'отменить контрольную точку можно: отмена ничего не утверждает',
          cancelled.status === 200,
          `статус ${cancelled.status}`,
        )

        // Попытка вернуть как было. Удаётся не всегда: отменённую контрольную
        // точку обратно в работу не пускают незакрытые этапы до неё.
        if (cancelled.status === 200) {
          await call('PATCH', `/api/workflow/stages/${handover.id}`, {
            status: 'IN_PROGRESS',
            comment: 'Пробник: возврат состояния',
          })
        }
      }

      // Обычный этап контрольной точкой не является и проходится свободно.
      const ordinary = stages.find(
        (stage) => stage.stageNumber === 3 && stage.status === 'NOT_STARTED',
      )
      if (ordinary) {
        const started = await call('PATCH', `/api/workflow/stages/${ordinary.id}`, {
          status: 'IN_PROGRESS',
        })
        check(
          'обычный этап начинается свободно — порядок гибридный, а не жёсткий',
          started.status === 200,
          `статус ${started.status}`,
        )
      }
    }
  }

  // Вуз не подтверждает то, что ему ещё не передали: этап 7 заблокирован
  // контрольной точкой — материалов нет, и подтверждение отвергается.
  if (rep) {
    actAs(rep.id)
    const materials = await call<Array<{ taskId: string; canConfirm: boolean; isConfirmed: boolean }>>(
      'GET',
      '/api/portal/materials',
    )
    const locked = (materials.body.data ?? []).find((item) => !item.isConfirmed && !item.canConfirm)
    if (!locked) {
      check('у вуза есть ещё не переданные материалы', false, 'нужен npm run db:seed')
    } else {
      const confirmed = await call('POST', `/api/portal/materials/${locked.taskId}/confirm`, {})
      check(
        'вуз не подтверждает материалы, которые ещё не переданы',
        confirmed.status === 409,
        `статус ${confirmed.status}`,
      )
      const after = await call<Array<{ taskId: string; isConfirmed: boolean }>>(
        'GET',
        '/api/portal/materials',
      )
      check(
        'отказ ничего не отметил',
        after.body.data?.find((item) => item.taskId === locked.taskId)?.isConfirmed === false,
      )
    }
    actAs(null)
  }
}

async function checkCountersNotTruncated(): Promise<void> {
  step('Счётчик не занижается обрезанием')

  for (const path of ['/api/skills/gaps', '/api/skills/demand', '/api/analytics/programs']) {
    const full = await call<unknown[]>('GET', `${path}?limit=200`)
    const fullMeta = (full.body as { meta?: { total?: number; truncated?: boolean } }).meta
    const fullTotal = fullMeta?.total ?? 0

    if (fullTotal < 2) {
      check(`${path}: данных хватает для проверки`, true, 'выборка мала, проверка пропущена')
      continue
    }

    const short = await call<unknown[]>('GET', `${path}?limit=1`)
    const shortMeta = (short.body as { meta?: { total?: number; truncated?: boolean } }).meta

    check(
      `${path}: total не уменьшается при обрезании`,
      shortMeta?.total === fullTotal,
      `при limit=1 total=${shortMeta?.total}, на полной выборке ${fullTotal}`,
    )
    check(
      `${path}: обрезание отмечено признаком`,
      shortMeta?.truncated === true && fullMeta?.truncated === false,
    )
    check(
      `${path}: отдано ровно столько, сколько просили`,
      (short.body.data?.length ?? 0) === 1,
    )
  }
}

async function checkUnknownRoute(): Promise<void> {
  step('Несуществующий адрес отвечает по контракту')

  for (const path of ['/api/universitie', '/api/portal/programs', '/api/nope/deep/path']) {
    const response = await fetch(`${BASE_URL}${path}`)
    const contentType = response.headers.get('content-type') ?? ''
    const text = await response.text()

    check(`${path}: статус 404`, response.status === 404, `статус ${response.status}`)
    check(
      `${path}: ответ JSON, а не HTML-страница`,
      contentType.includes('application/json'),
      `тип ${contentType.split(';')[0]}`,
    )

    let code: string | undefined
    try {
      code = (JSON.parse(text) as { error?: { code?: string } }).error?.code
    } catch {
      code = undefined
    }
    check(`${path}: код ошибки NOT_FOUND`, code === 'NOT_FOUND', `получено ${code ?? 'не JSON'}`)
  }
}

async function checkSecurityHeaders(): Promise<void> {
  step('Ответы несут защитные заголовки')

  const expected: Array<[string, string]> = [
    ['x-content-type-options', 'nosniff'],
    ['x-frame-options', 'DENY'],
    ['referrer-policy', 'strict-origin-when-cross-origin'],
    ['cross-origin-opener-policy', 'same-origin'],
  ]

  // Заголовки не видны ни одному тесту функциональности: приложение работает
  // и без них. Поэтому проверяются отдельно — иначе пропажа пройдёт незамеченной.
  for (const target of ['/api/health', '/api/universities', '/']) {
    const response = await fetch(`${BASE_URL}${target}`, {
      headers: actingUserId ? { cookie: `skilllink_user=${actingUserId}` } : {},
    })
    await response.arrayBuffer()

    for (const [header, value] of expected) {
      check(
        `${target}: ${header}`,
        response.headers.get(header) === value,
        `получено ${response.headers.get(header) ?? 'ничего'}`,
      )
    }

    check(
      `${target}: Permissions-Policy задан`,
      (response.headers.get('permissions-policy') ?? '').includes('camera=()'),
    )
    check(
      `${target}: CSP запрещает встраивание в чужие страницы`,
      (response.headers.get('content-security-policy') ?? '').includes("frame-ancestors 'none'"),
      `получено ${response.headers.get('content-security-policy') ?? 'ничего'}`,
    )
    check(
      `${target}: X-Powered-By не выдаёт платформу`,
      response.headers.get('x-powered-by') === null,
      `получено ${response.headers.get('x-powered-by')}`,
    )
  }

  // Страницы — под полной политикой: скрипты только с nonce запроса (решение 112).
  // Без сессии `/` уводит на вход — проверяется то, что браузер получит в итоге.
  const scriptSrcNonce = /script-src 'nonce-([A-Za-z0-9+/_-]+={0,2})' 'strict-dynamic'/
  const pageNonces: string[] = []
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(`${BASE_URL}/`, {
      headers: actingUserId ? { cookie: `skilllink_user=${actingUserId}` } : {},
    })
    const html = await response.text()
    const policy = response.headers.get('content-security-policy') ?? ''
    const nonce = policy.match(scriptSrcNonce)?.[1]
    check('страница: CSP со script-src по nonce и strict-dynamic', nonce !== undefined, `получено ${policy || 'ничего'}`)
    if (nonce === undefined) continue
    pageNonces.push(nonce)
    // Скрипты страницы несут тот же nonce, что в заголовке: иначе браузер их не исполнит.
    const scripts = html.match(/<script\b[^>]*>/g) ?? []
    const withoutNonce = scripts.filter((tag) => !tag.includes(`nonce="${nonce}"`))
    check(
      'страница: все <script> с nonce из заголовка',
      scripts.length > 0 && withoutNonce.length === 0,
      `без nonce ${withoutNonce.length} из ${scripts.length}`,
    )
  }
  check('страница: nonce у каждого ответа свой', pageNonces.length === 2 && pageNonces[0] !== pageNonces[1])

  // Изменяющий запрос со страницы чужого сайта: браузер подписывает его
  // заголовком Origin, и сервер обязан отказать до всякой записи.
  const crossSite = await fetch(`${BASE_URL}/api/universities`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://evil.example',
      ...(actingUserId ? { cookie: `skilllink_user=${actingUserId}` } : {}),
    },
    body: JSON.stringify({ name: 'Пробник: запрос с чужого сайта', city: 'Тверь', region: 'Тверская область' }),
  })
  await crossSite.arrayBuffer()
  check('изменяющий запрос с чужого сайта отклонён', crossSite.status === 403, `код ${crossSite.status}`)
}

async function checkRatingMethodsAgree(): Promise<void> {
  step('Два способа расчёта рейтинга дают один результат')

  // Реестр считает рейтинг по программам одной страницы, сортировка — по всем
  // сразу. Если пути разойдутся, вуз получит разный балл в зависимости от того,
  // как открыли список, — и заметить это без сравнения невозможно.
  type Rated = {
    id: string
    rating: { score: number | null; basis: string; ratedProgramCount: number } | null
  }

  const byPage = await call<Rated[]>('GET', '/api/universities?pageSize=100')
  const bySort = await call<Rated[]>('GET', '/api/universities?pageSize=100&sort=-rating')

  const fast = new Map((byPage.body.data ?? []).map((row) => [row.id, row.rating]))
  const full = new Map((bySort.body.data ?? []).map((row) => [row.id, row.rating]))

  let compared = 0
  let mismatched = 0
  for (const [id, rating] of fast) {
    const other = full.get(id)
    if (!other || !rating) continue
    compared += 1
    if (
      rating.score !== other.score ||
      rating.basis !== other.basis ||
      rating.ratedProgramCount !== other.ratedProgramCount
    ) {
      mismatched += 1
    }
  }

  check('есть что сравнивать', compared > 0, `сравнено ${compared}`)
  check(
    'быстрый расчёт по странице совпадает с полным',
    mismatched === 0,
    `расхождений ${mismatched} из ${compared}`,
  )

  // Карточка вуза считает рейтинг третьим способом — по одному вузу.
  const first = (byPage.body.data ?? []).find((row) => row.rating?.score !== null)
  if (first) {
    const card = await call<Rated>('GET', `/api/universities/${first.id}`)
    check(
      'рейтинг в карточке совпадает с рейтингом в списке',
      card.body.data?.rating?.score === first.rating?.score,
      `карточка ${card.body.data?.rating?.score}, список ${first.rating?.score}`,
    )
  }
}

async function checkNoContradictionsInDb(): Promise<void> {
  step('В базе нет противоречивых состояний')

  // Половинчатая запись не видна ни одному функциональному тесту: страницы
  // открываются, ошибок нет. Заметна она только сплошной проверкой.
  type StageRow = {
    stageNumber: number
    status: string
    result: string | null
    blockingReason: string | null
    completedAt: string | null
  }

  const list = await call<Array<{ id: string }>>('GET', '/api/cooperations?pageSize=100')
  const cooperations = list.body.data ?? []
  check('связки для проверки есть', cooperations.length > 0)

  let wrongStageCount = 0
  let completedWithoutResult = 0
  let blockedWithoutReason = 0
  let completedWithoutDate = 0
  let openWithDate = 0

  for (const row of cooperations) {
    const card = await call<{ stages: StageRow[] }>('GET', `/api/cooperations/${row.id}`)
    const stages = card.body.data?.stages ?? []

    if (stages.length !== 14) wrongStageCount += 1

    for (const stage of stages) {
      const isControlStage = stage.stageNumber === 14
      if (stage.status === 'COMPLETED' && !isControlStage) {
        if (!stage.result || stage.result.trim() === '') completedWithoutResult += 1
        if (!stage.completedAt) completedWithoutDate += 1
      }
      if (stage.status === 'BLOCKED' && !stage.blockingReason) blockedWithoutReason += 1
      if (stage.status !== 'COMPLETED' && stage.completedAt) openWithDate += 1
    }
  }

  check('у каждой связки ровно 14 этапов', wrongStageCount === 0, `нарушений ${wrongStageCount}`)
  check(
    'завершённый этап всегда имеет результат',
    completedWithoutResult === 0,
    `без результата ${completedWithoutResult}`,
  )
  check(
    'завершённый этап всегда имеет дату завершения',
    completedWithoutDate === 0,
    `без даты ${completedWithoutDate}`,
  )
  check(
    'незавершённый этап не хранит дату завершения',
    openWithDate === 0,
    `с лишней датой ${openWithDate}`,
  )
  check(
    'заблокированный этап всегда имеет причину',
    blockedWithoutReason === 0,
    `без причины ${blockedWithoutReason}`,
  )

  const recs = await call<Array<{ justification: string }>>(
    'GET',
    '/api/recommendations?pageSize=100',
  )
  check(
    'у каждой рекомендации есть обоснование',
    (recs.body.data ?? []).every((rec) => rec.justification && rec.justification.length > 0),
  )
}

async function checkStageNotCountedTwice(): Promise<void> {
  step('Этап не считается проблемным дважды')

  type Coop = {
    currentStage: { isOverdue: boolean; isDueSoon: boolean } | null
    progress: { overdueStages: number; dueSoonStages: number; totalStages: number }
  }

  const list = await call<Coop[]>('GET', '/api/cooperations?pageSize=100')
  const rows = list.body.data ?? []

  const bothAtOnce = rows.filter(
    (row) => row.currentStage?.isOverdue && row.currentStage?.isDueSoon,
  ).length
  check(
    'этап не бывает одновременно просроченным и предстоящим',
    bothAtOnce === 0,
    `таких ${bothAtOnce}`,
  )

  const overCount = rows.filter((row) => row.currentStage?.isOverdue).length
  const soonCount = rows.filter((row) => row.currentStage?.isDueSoon).length
  check('признаки вообще встречаются', overCount + soonCount > 0, `просрочено ${overCount}, скоро ${soonCount}`)

  const impossible = rows.filter(
    (row) => row.progress.overdueStages + row.progress.dueSoonStages > row.progress.totalStages,
  ).length
  check(
    'счётчики не превышают числа этапов',
    impossible === 0,
    `нарушений ${impossible}`,
  )
}

async function checkHealth(): Promise<void> {
  step('Здоровье приложения отвечает по делу')

  const response = await fetch(`${BASE_URL}/api/health`)
  const body = (await response.json()) as {
    data?: { status?: string; database?: string; schema?: string; hint?: string }
  }
  const health = body.data ?? {}

  check('статус ok на рабочем приложении', health.status === 'ok', `получено ${health.status}`)
  check('соединение с базой подтверждено', health.database === 'connected')
  check('схема отмечена применённой', health.schema === 'ready')
  check(
    'на здоровом приложении подсказки нет',
    health.hint === undefined,
    'подсказка появляется только при проблеме',
  )
}

async function checkClosedCooperationQuiet(): Promise<void> {
  step('Закрытая связка не требует внимания')

  // Этапы закрытой связки заморожены: изменить их нельзя. Показывать их как
  // просроченные значит просить сделать то, что система же и запрещает —
  // и заполнять дашборд тем, на что никто не может повлиять.
  type CoopRow = { id: string; status: string }
  type StageRow = { cooperation?: { id?: string }; cooperationId?: string }

  // Закрытые — отбором по статусу, а не с первой страницы реестра: на рабочей
  // базе новые связки вытесняют закрытые за первую сотню.
  const coops = await call<CoopRow[]>(
    'GET',
    '/api/cooperations?status=COMPLETED&status=CANCELLED&pageSize=100',
  )
  const closedIds = new Set((coops.body.data ?? []).map((row) => row.id))
  const isClosed = (id?: string) => id !== undefined && closedIds.has(id)

  const coopId = (row: StageRow) => row.cooperation?.id ?? row.cooperationId

  const closedCount = closedIds.size
  check('в данных есть закрытые связки', closedCount > 0, `закрытых ${closedCount}`)

  for (const [path, title] of [
    ['/api/workflow/overdue?pageSize=100', 'просроченных'],
    ['/api/workflow/blocked?pageSize=100', 'заблокированных'],
  ] as const) {
    const rows = (await call<StageRow[]>('GET', path)).body.data ?? []
    const leaked = rows.filter((row) => isClosed(coopId(row)))
    check(
      `среди ${title} нет этапов закрытых связок`,
      leaked.length === 0,
      `просочилось ${leaked.length} из ${rows.length}`,
    )
  }

  // Контрольный этап вычисляется автоматически и руками не меняется.
  // Предлагать по нему действие — значит просить невозможного, а его просрочка
  // и так объясняется незакрытыми этапами 1–13, которые в списке уже есть.
  for (const [path, title] of [
    ['/api/workflow/overdue?pageSize=100', 'просроченных'],
    ['/api/workflow/blocked?pageSize=100', 'заблокированных'],
  ] as const) {
    const rows = (await call<Array<{ stageNumber: number }>>('GET', path)).body.data ?? []
    check(
      `среди ${title} нет контрольного этапа`,
      rows.every((row) => row.stageNumber !== 14),
      `нашлось ${rows.filter((row) => row.stageNumber === 14).length}`,
    )
  }

  const dashboard = await call<{
    problemCooperations: Array<{ cooperationId: string; stageNumber: number }>
  }>('GET', '/api/analytics/overview')
  const problems = dashboard.body.data?.problemCooperations ?? []
  const leakedOnDashboard = problems.filter((row) => isClosed(row.cooperationId))
  check(
    'на дашборде нет проблем по закрытым связкам',
    leakedOnDashboard.length === 0,
    `просочилось ${leakedOnDashboard.length} из ${problems.length}`,
  )
  check(
    'на дашборде нет контрольного этапа',
    problems.every((row) => row.stageNumber !== 14),
  )
}

async function checkRussianSorting(ctx: ProbeContext): Promise<void> {
  step('Списки отсортированы по-русски')
  const { adminId } = ctx

  // Порядок строк по умолчанию зависит от локали кластера PostgreSQL и на
  // разных машинах разный: на macOS кириллица сортируется почти случайно,
  // в postgres:16-alpine — по кодам символов («Ёлкин» раньше «Абв»).
  // Поэтому у колонок сортировки задана ICU-сортировка "ru-x-icu"
  // (миграция 20260922073000_russian_collation). Здесь проверяется, что
  // она действительно применена к той базе, против которой работает сервер.
  actAs(adminId)
  const collator = new Intl.Collator('ru')

  const listChecks: Array<[string, string]> = [
    ['реестр вузов', '/api/universities?pageSize=100'],
    ['справочник навыков', '/api/skills?pageSize=100'],
    ['каталог продуктов', '/api/products?pageSize=100'],
  ]

  for (const [title, path] of listChecks) {
    const list = await call<Array<{ name: string }>>('GET', path)
    const names = (list.body.data ?? []).map((item) => item.name)
    const expected = [...names].sort(collator.compare)
    const misplaced = names.filter((name, index) => name !== expected[index]).length
    check(
      `${title}: русский алфавитный порядок`,
      names.length > 0 && misplaced === 0,
      names.length === 0 ? 'список пуст' : `не на своём месте ${misplaced} из ${names.length}`,
    )
  }

  // Отдельно — буква Ё: по кодам символов она раньше всех русских букв,
  // по-русски стоит после Е. Самый частый способ незаметно потерять порядок.
  const sorted = await call<Array<{ name: string }>>('GET', '/api/skills?pageSize=100')
  const skillNames = (sorted.body.data ?? []).map((item) => item.name)
  const probeNames = [...skillNames, 'Ёмкость хранилища', 'Единицы измерения', 'Журналирование']
  const byCollator = [...probeNames].sort(collator.compare)
  check(
    'проверка порядка вообще различает Ё и Е',
    byCollator.indexOf('Ёмкость хранилища') > byCollator.indexOf('Единицы измерения') &&
      byCollator.indexOf('Ёмкость хранилища') < byCollator.indexOf('Журналирование'),
  )
}

async function checkProgramCardMatchesAnalytics(ctx: ProbeContext): Promise<void> {
  step('Карточка программы и личный кабинет не расходятся с аналитикой')
  const { rep, adminId } = ctx

  actAs(adminId)
  const ranked = await call<Array<{ programId: string; score: number | null }>>(
    'GET',
    '/api/analytics/programs?limit=100',
  )
  const scoreInRanking = new Map((ranked.body.data ?? []).map((row) => [row.programId, row.score]))
  const programs = await call<Array<{ id: string; status: string }>>(
    'GET',
    '/api/programs?pageSize=100',
  )

  // Балл в заголовке карточки считается отдельно от рейтинга — и обязан с ним
  // совпадать: иначе одна программа покажет два разных числа.
  let compared = 0
  let differs = 0
  // Сравниваем только программы, попавшие в обе выдачи: рейтинг отдаёт первые
  // сто по баллу, список — первые сто по алфавиту, и на базе больше сотни
  // программ часть списка в рейтинг не попадает вовсе.
  const comparable = (programs.body.data ?? []).filter(
    (item) => item.status === 'ACTIVE' && scoreInRanking.has(item.id),
  )
  for (const program of comparable) {
    const card = await call<{ rating: { score: number | null } | null }>(
      'GET',
      `/api/programs/${program.id}`,
    )
    compared += 1
    if (card.body.data?.rating?.score !== scoreInRanking.get(program.id)) differs += 1
  }
  check(
    'балл в карточке программы совпадает с рейтингом программ',
    compared > 0 && differs === 0,
    `расхождений ${differs} из ${compared}`,
  )

  const stats = await call<{
    activeCooperations: number
    universitiesInWork: number
    programsManaged: number
    stagesOnTimePercent: number | null
    overdueStages: number
  }>('GET', '/api/me/stats')
  const s = stats.body.data
  check(
    'личная статистика отвечает и согласована сама с собой',
    stats.status === 200 &&
      s !== undefined &&
      s.universitiesInWork <= s.activeCooperations &&
      s.programsManaged <= s.activeCooperations &&
      s.overdueStages >= 0 &&
      (s.stagesOnTimePercent === null || (s.stagesOnTimePercent >= 0 && s.stagesOnTimePercent <= 100)),
    s ? `связок ${s.activeCooperations}, вузов ${s.universitiesInWork}, программ ${s.programsManaged}` : `код ${stats.status}`,
  )

  if (rep) {
    actAs(rep.id)
    const own = await call<Array<{ id: string }>>('GET', '/api/programs?pageSize=1')
    const ownId = own.body.data?.[0]?.id
    if (ownId) {
      const card = await call<{ rating: unknown }>('GET', `/api/programs/${ownId}`)
      check(
        'представитель вуза видит карточку своей программы, но не рейтинг',
        card.status === 200 && card.body.data?.rating === null,
        `код ${card.status}`,
      )
    }
    const me = await call<{ universityName: string | null }>('GET', '/api/me')
    check('у представителя вуза в /api/me есть название вуза', Boolean(me.body.data?.universityName))
  }
}

async function checkSearchAndNotifications(ctx: ProbeContext): Promise<void> {
  step('Поиск и уведомления не раскрывают чужого и не врут')
  const { rep, adminId, foreignUniversity, managerId } = ctx

  // Поиск: представитель вуза не находит чужой вуз, который находит администратор.
  if (rep && foreignUniversity) {
    const word = foreignUniversity.name.split(' ')[0] ?? foreignUniversity.name
    actAs(adminId)
    const forAdmin = await call<{ groups: Array<{ type: string; items: Array<{ id: string }> }> }>(
      'GET',
      `/api/search?q=${encodeURIComponent(word)}`,
    )
    const adminFinds = (forAdmin.body.data?.groups ?? []).some(
      (group) => group.type === 'university' && group.items.some((item) => item.id === foreignUniversity.id),
    )
    actAs(rep.id)
    const forRep = await call<{ groups: Array<{ type: string; items: Array<{ id: string }> }> }>(
      'GET',
      `/api/search?q=${encodeURIComponent(word)}`,
    )
    const repFinds = (forRep.body.data?.groups ?? []).some((group) =>
      group.items.some((item) => item.id === foreignUniversity.id),
    )
    check('поиск находит вуз администратору', adminFinds, `по слову «${word}»`)
    check('поиск не находит чужой вуз представителю', forRep.status === 200 && !repFinds)
  }

  // Знаки LIKE в запросе — обычные символы, а не «что угодно»: иначе поиск «_»
  // нашёл бы все вузы базы. От имени администратора: представитель вуза
  // видит один вуз, и сравнение с ним ничего не доказало бы.
  const actorBefore = actingUserId
  actAs(adminId)
  const all = await call<unknown[]>('GET', '/api/universities?withRating=false&pageSize=1')
  for (const wildcard of ['_', '%']) {
    const found = await call<unknown[]>(
      'GET',
      `/api/universities?withRating=false&pageSize=1&q=${encodeURIComponent(wildcard)}`,
    )
    check(
      `поиск «${wildcard}» не находит всё подряд`,
      Number(found.body.meta?.total ?? -1) < Number(all.body.meta?.total ?? 0),
      `найдено ${String(found.body.meta?.total)} из ${String(all.body.meta?.total)}`,
    )
  }
  actAs(actorBefore)

  const tooShort = await call('GET', '/api/search?q=a')
  check('поиск по одной букве отклоняется', tooShort.status === 422)

  type Feed = {
    items: Array<{
      kind: string
      title: string
      target: { type: string; id: string; cooperationId: string | null }
    }>
    unreadCount: number
  }
  const targetPath: Record<string, string> = {
    cooperation: '/api/cooperations/',
    document: '/api/documents/',
    recommendation: '/api/recommendations/',
  }

  // Уведомления сотрудника: просрочки считаются так же, как в личной статистике,
  // и каждая ссылка открывается тем, кому пришло уведомление.
  if (managerId) {
    actAs(managerId)
    const feed = await call<Feed>('GET', '/api/notifications?limit=50')
    const stats = await call<{ overdueStages: number }>('GET', '/api/me/stats')
    const overdue = (feed.body.data?.items ?? []).filter((item) => item.kind === 'stage.overdue').length
    // Этапы, которые не начать из-за незавершённой контрольной точки, лента не торопит,
    // а личная статистика считает (её счётчик — решение продукта). Разница — ровно они.
    const locked = await countLockedOverdueOf(managerId)
    check(
      'просроченных в ленте столько же, сколько в личной статистике, без запертых точкой',
      feed.status === 200 && overdue === (stats.body.data?.overdueStages ?? -1) - locked,
      `лента ${overdue}, статистика ${stats.body.data?.overdueStages}, заперто точкой ${locked}`,
    )
    // Одна просрочка — одно уведомление: рекомендация «Просрочен этап N» не повторяет срок этапа.
    const overdueEvent = (item: Feed['items'][number]) => {
      const stage = /^Просрочен этап (\d+)/.exec(item.title)?.[1]
      return stage ? `${item.target.cooperationId}:${stage}` : null
    }
    const fromStages = new Set(
      (feed.body.data?.items ?? []).filter((item) => item.kind === 'stage.overdue').map(overdueEvent),
    )
    const duplicates = (feed.body.data?.items ?? []).filter(
      (item) => item.kind === 'recommendation' && fromStages.has(overdueEvent(item)),
    )
    check('просрочка в ленте не повторяется рекомендацией', duplicates.length === 0, `повторов ${duplicates.length}`)
    let broken = 0
    for (const item of feed.body.data?.items ?? []) {
      const opened = await call('GET', `${targetPath[item.target.type]}${item.target.id}`)
      if (opened.status !== 200) broken += 1
    }
    check(
      'каждое уведомление сотрудника открывается',
      broken === 0,
      `не открылось ${broken} из ${feed.body.data?.items.length ?? 0}`,
    )
    const later = new Date(Date.now() + 1000).toISOString()
    const read = await call<Feed>('GET', `/api/notifications?since=${encodeURIComponent(later)}`)
    check('после отметки «прочитано» непрочитанных нет', read.body.data?.unreadCount === 0)
  }

  // Уведомления представителя вуза: ни сроков, ни рекомендаций — это внутреннее.
  if (rep) {
    actAs(rep.id)
    const feed = await call<Feed>('GET', '/api/notifications?limit=50')
    const internal = (feed.body.data?.items ?? []).filter((item) =>
      ['stage.overdue', 'stage.due-soon', 'recommendation'].includes(item.kind),
    ).length
    check('в ленте представителя вуза нет внутреннего', feed.status === 200 && internal === 0)
    let broken = 0
    for (const item of feed.body.data?.items ?? []) {
      const opened = await call('GET', `${targetPath[item.target.type]}${item.target.id}`)
      if (opened.status !== 200) broken += 1
    }
    check('каждое уведомление представителя вуза открывается у него', broken === 0)
  }
}

async function checkCooperationSearch(ctx: ProbeContext): Promise<void> {
  step('Связку находят по краткому имени вуза, по словам и по ответственному')
  const { adminId, managerId } = ctx

  if (managerId) {
    // Свой вуз с уникальным кратким именем: демо-данные не трогаются, и совпадение
    // не может прийти от соседней записи.
    const actorBefore = actingUserId
    actAs(adminId)
    const sfx = Date.now().toString().slice(-6)
    const shortName = `ПРБ${sfx}`
    const uni = await call<{ id: string }>('POST', '/api/universities', {
      name: `Пробный университет поиска ${sfx}`,
      shortName,
      city: 'Тверь',
      region: 'Тверская область',
    })
    const program = await call<{ id: string }>('POST', '/api/programs', {
      universityId: uni.body.data?.id,
      name: `Программная инженерия поиска ${sfx}`,
      level: 'BACHELOR',
    })
    const created = await call<{ id: string; responsible: { fullName: string } }>(
      'POST',
      '/api/cooperations',
      { universityId: uni.body.data?.id, programId: program.body.data?.id, responsibleId: managerId },
    )
    const cooperationId = created.body.data?.id
    const surname = created.body.data?.responsible.fullName.split(' ')[0] ?? ''

    const byShortName = await call<Array<{ id: string }>>(
      'GET',
      `/api/cooperations?q=${encodeURIComponent(shortName.toLowerCase())}`,
    )
    check(
      'реестр связок находит связку по краткому имени вуза',
      (byShortName.body.data ?? []).some((row) => row.id === cooperationId),
      `найдено ${byShortName.body.data?.length ?? 0}`,
    )

    type Search = { groups: Array<{ type: string; items: Array<{ id: string; title: string }> }> }
    const twoWords = await call<Search>(
      'GET',
      `/api/search?q=${encodeURIComponent(`${shortName.toLowerCase()} программная`)}`,
    )
    const found = (twoWords.body.data?.groups ?? [])
      .find((group) => group.type === 'cooperation')
      ?.items.find((item) => item.id === cooperationId)
    check(
      'глобальный поиск по двум словам находит связку',
      found !== undefined,
      `запрос «${shortName.toLowerCase()} программная»`,
    )
    check(
      'связка в поиске подписана кратким именем вуза',
      found?.title === `${shortName} — Программная инженерия поиска ${sfx}`,
      `заголовок: ${found?.title ?? '—'}`,
    )

    const byResponsible = await call<Array<{ id: string }>>(
      'GET',
      `/api/cooperations?q=${encodeURIComponent(`${surname} ${shortName}`)}`,
    )
    check(
      'связку находят по фамилии ответственного',
      (byResponsible.body.data ?? []).some((row) => row.id === cooperationId),
      `запрос «${surname} ${shortName}»`,
    )
    const wrongWord = await call<unknown[]>(
      'GET',
      `/api/cooperations?q=${encodeURIComponent(`${shortName} несуществующееслово`)}`,
    )
    check('каждое слово запроса обязательно', (wrongWord.body.data?.length ?? -1) === 0)
    actAs(actorBefore)
  }
}

async function checkProblemCounter(ctx: ProbeContext): Promise<void> {
  step('Счётчик проблем на главной совпадает со списками этапов')
  const { adminId } = ctx

  /*
   * Главная показывает самые давние проблемные этапы и отдельным числом —
   * сколько их всего. Число обязано совпасть с тем, что отдают списки
   * просроченных и заблокированных этапов: иначе на первом экране показа
   * будет одно, а в реестре — другое. Этап, который и просрочен,
   * и заблокирован, — одна проблема, а не две.
   */
  actAs(adminId)
  const overview = await call<{
    problemStageTotal: number
    problemCooperations: Array<{ stageId: string | null }>
  }>('GET', '/api/analytics/overview')
  const overdue = await call<Array<{ id: string; stageNumber: number }>>(
    'GET',
    '/api/workflow/overdue?pageSize=100',
  )
  const blocked = await call<Array<{ id: string; stageNumber: number }>>(
    'GET',
    '/api/workflow/blocked?pageSize=100',
  )
  const listed = new Set(
    [...(overdue.body.data ?? []), ...(blocked.body.data ?? [])]
      // Контрольный этап вычисляется системой — в проблемы главной он не входит.
      .filter((stage) => stage.stageNumber !== 14)
      .map((stage) => stage.id),
  )
  const total = overview.body.data?.problemStageTotal ?? -1
  const shown = overview.body.data?.problemCooperations ?? []
  check(
    'счётчик проблем совпадает со списками просроченных и заблокированных',
    total === listed.size,
    `на главной ${total}, в списках ${listed.size}`,
  )
  check(
    'показано не больше, чем есть',
    shown.length <= total,
    `показано ${shown.length} из ${total}`,
  )
  check(
    'каждая показанная проблема есть в списках',
    shown.every((item) => item.stageId !== null && listed.has(item.stageId)),
  )
  actAs(null)
}

async function checkCooperationCount(ctx: ProbeContext): Promise<void> {
  step('Число связок на главной сходится с разбивкой и реестром')
  const { adminId } = ctx

  /*
   * Разбивка одна для меню, главной и фильтров (решение 86): активные = в работе
   * + черновики, воронка = активные + пауза + завершённые, блок «Связки в работе»
   * список не обрезает. Сверяем её с показателем и с реестром теми же фильтрами.
   */
  actAs(adminId)
  const overview = await call<{
    metrics: Array<{ key: string; value: number | null }>
    cooperationCounts: {
      active: number
      inWork: number
      drafts: number
      paused: number
      completed: number
      total: number
    }
  }>('GET', '/api/analytics/overview')
  const counts = overview.body.data?.cooperationCounts
  const metricValue = overview.body.data?.metrics.find((item) => item.key === 'activeCooperations')?.value
  const listed = async (query: string) =>
    (await call<unknown[]>('GET', `/api/cooperations?${query}&pageSize=1`)).body.meta?.total ?? -1
  const activeListed = await listed('status=DRAFT&status=ACTIVE')
  const funnelListed = await listed('status=DRAFT&status=ACTIVE&status=PAUSED&status=COMPLETED')
  check('разбивка связок есть в сводке главной', counts !== undefined)
  if (counts) {
    check(
      'показатель «Активные связи» равен разбивке',
      metricValue === counts.active,
      `показатель ${metricValue}, разбивка ${counts.active}`,
    )
    check(
      'активные = в работе + черновики',
      counts.active === counts.inWork + counts.drafts,
      `активных ${counts.active}, в работе ${counts.inWork}, черновиков ${counts.drafts}`,
    )
    check(
      'в воронке = активные + на паузе + завершённые',
      counts.total === counts.active + counts.paused + counts.completed,
    )
    check('активных столько же, сколько в реестре', counts.active === activeListed, `главная ${counts.active}, реестр ${activeListed}`)
    check('в воронке столько же, сколько в реестре', counts.total === funnelListed, `главная ${counts.total}, реестр ${funnelListed}`)
  }
  actAs(null)
}

async function checkRecommendationFeedOrder(ctx: ProbeContext): Promise<void> {
  step('Лента рекомендаций — по важности, страницы устойчивы')
  const { adminId } = ctx

  /*
   * Приоритет — перечисление LOW < MEDIUM < HIGH < CRITICAL, и сортировка
   * «по приоритету» по возрастанию ставит сверху наименее важное: критичные
   * просрочки оказались бы в самом низу ленты. Проверяем тем же запросом, что делает
   * интерфейс, и заодно — что при равной важности страницы не теряют
   * и не повторяют строки.
   */
  actAs(adminId)
  const rank: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 }
  const sortParam = `sort=${RECOMMENDATION_SORT_MOST_IMPORTANT}`
  const all = await call<Array<{ id: string; priority: string }>>(
    'GET',
    `/api/recommendations?${sortParam}&pageSize=100`,
  )
  const rows = all.body.data ?? []
  const firstOutOfOrder = rows.findIndex(
    (row, index) => index > 0 && (rank[row.priority] ?? -1) > (rank[rows[index - 1]?.priority ?? ''] ?? -1),
  )
  check(
    'важность в ленте не растёт сверху вниз',
    rows.length > 1 && firstOutOfOrder === -1,
    firstOutOfOrder === -1
      ? `${rows.length} рекомендаций, сверху ${rows[0]?.priority ?? '—'}`
      : `строка ${firstOutOfOrder + 1} важнее предыдущей`,
  )

  const paged: string[] = []
  const total = Number(all.body.meta?.total ?? 0)
  for (let page = 1; page <= Math.ceil(total / 3) && page <= 40; page += 1) {
    const chunk = await call<Array<{ id: string }>>(
      'GET',
      `/api/recommendations?${sortParam}&page=${page}&pageSize=3`,
    )
    paged.push(...(chunk.body.data ?? []).map((row) => row.id))
  }
  // Один запрос отдаёт не больше сотни — сверяются первые строки обхода,
  // а обход целиком — на повторы и потери.
  check(
    'постраничный обход даёт тот же порядок, что и один запрос',
    paged.slice(0, rows.length).join() === rows.map((row) => row.id).join() &&
      new Set(paged).size === paged.length &&
      paged.length === Math.min(total, 120),
    `${paged.length} строк по страницам, ${new Set(paged).size} разных, всего ${total}`,
  )

  /*
   * То же для реестров, где равные значения — норма: десятки программ
   * одного уровня, связки одного статуса. Сортировка по такому полю без
   * последнего ключа отдаёт равные строки в произвольном порядке.
   */
  for (const list of [
    '/api/programs?sort=level',
    '/api/cooperations?sort=status',
    '/api/universities?sort=status&withRating=false',
    '/api/documents?sort=status',
  ]) {
    const whole = await call<Array<{ id: string }>>('GET', `${list}&pageSize=100`)
    const expected = (whole.body.data ?? []).map((row) => row.id)
    const listTotal = Number(whole.body.meta?.total ?? 0)
    const walked: string[] = []
    for (let page = 1; page <= Math.ceil(Math.min(listTotal, 100) / 7); page += 1) {
      const chunk = await call<Array<{ id: string }>>('GET', `${list}&page=${page}&pageSize=7`)
      walked.push(...(chunk.body.data ?? []).map((row) => row.id))
    }
    const comparable = walked.slice(0, expected.length)
    check(
      `${list.split('?')[0]}: страницы не повторяют и не теряют строки`,
      expected.length > 0 && comparable.join() === expected.join(),
      `${new Set(comparable).size} разных из ${expected.length}`,
    )
  }
  actAs(null)
}

async function checkCalculationParameters(ctx: ProbeContext): Promise<void> {
  step('Параметры расчётов: значения из кода, права ролей')
  const { rep } = ctx

  const byRole = async (role: string) => {
    const found = await call<Array<{ id: string }>>('GET', `/api/users?role=${role}&pageSize=1`)
    return found.body.data?.[0]?.id ?? null
  }
  const analystId = await byRole('ANALYST')
  const viewerId = await byRole('VIEWER')

  type Parameters = {
    groups: Array<{ id: string; parameters: Array<{ configKey: string; value: unknown; isTemporary: boolean }> }>
    stages: Array<{ number: number; normativeDays: number; isControlPoint: boolean }>
  }
  actAs(analystId)
  const asAnalyst = await call<Parameters>('GET', '/api/settings/parameters')
  const values = new Map(
    (asAnalyst.body.data?.groups ?? []).flatMap((group) => group.parameters.map((item) => [item.configKey, item])),
  )
  check('аналитик получает параметры: 200', asAnalyst.status === 200, `статус ${asAnalyst.status}`)
  check(
    'значения — те же константы, по которым считает код',
    values.get('SKILL_GAP.demandThreshold')?.value === SKILL_GAP.demandThreshold &&
      values.get('PROGRAM_RATING_WEIGHTS.applicationCount')?.value === PROGRAM_RATING_WEIGHTS.applicationCount &&
      values.get('RECOMMENDATION_RULES.stalledDays')?.value === RECOMMENDATION_RULES.stalledDays &&
      // Порог дефицита утверждён заказчиком, порог застоя — рабочее значение.
      values.get('SKILL_GAP.demandThreshold')?.isTemporary === false &&
      values.get('RECOMMENDATION_RULES.stalledDays')?.isTemporary === true,
  )
  const stages = asAnalyst.body.data?.stages ?? []
  check(
    '14 этапов с нормативами из workflow.config, контрольные точки отмечены',
    stages.length === WORKFLOW_STAGES.length &&
      stages.every((stage, index) => stage.normativeDays === WORKFLOW_STAGES[index]!.normativeDays) &&
      stages.filter((stage) => stage.isControlPoint).map((stage) => stage.number).join() ===
        CONTROL_POINT_STAGES.join(),
    `этапов ${stages.length}`,
  )
  actAs(viewerId)
  const asViewer = await call('GET', '/api/settings/parameters')
  check('наблюдатель тоже видит (объяснение чисел аналитики): 200', asViewer.status === 200, `статус ${asViewer.status}`)
  actAs(rep?.id ?? null)
  const asRep = await call('GET', '/api/settings/parameters')
  check('представителю вуза закрыто, как и аналитика: 403', asRep.status === 403, `статус ${asRep.status}`)
  actAs(null)
}

async function checkSkillDirectory(ctx: ProbeContext): Promise<void> {
  step('Справочник навыков: права, дубли, объединение, удаление используемого')
  const { adminId, managerId } = ctx

  if (!adminId || !managerId) {
    check('демо-данные готовы (администратор и менеджер)', false, 'запустите npm run db:seed')
  } else {
    type Skill = { id: string; name: string; programCount: number; productCount: number }
    type ProgramCard = {
      id: string
      skills: Array<{ skillId: string; level: string; importance: string; source: string; confidence: string | null; comment: string | null }>
    }
    type ProductCard = { id: string; skills: Array<{ skillId: string; relevance: string }> }
    type Gap = { skillId: string; gap: number; isCritical: boolean }
    const gapsDigest = async () => {
      const result = await call<Gap[]>('GET', '/api/skills/gaps?limit=200')
      return `${String(result.body.meta?.total)}:${JSON.stringify(
        (result.body.data ?? []).map((row) => [row.skillId, row.gap, row.isCritical]),
      )}`
    }

    const sfx = Date.now().toString().slice(-6)
    const nameA = `Пробный навык ${sfx}`
    const nameB = `Пробный навык-дубль ${sfx}`

    // Не админ: 403 на каждое изменение.
    actAs(managerId)
    const managerCreate = await call('POST', '/api/skills', { name: nameA, category: 'Пробная' })
    const managerPatch = await call('PATCH', '/api/skills/any', { category: 'Пробная' })
    const managerMerge = await call('POST', '/api/skills/any/merge', { targetId: 'other' })
    const managerDelete = await call('DELETE', '/api/skills/any')
    check(
      'менеджер не меняет справочник: 403 на создание, правку, объединение, удаление',
      [managerCreate, managerPatch, managerMerge, managerDelete].every((result) => result.status === 403),
      [managerCreate, managerPatch, managerMerge, managerDelete].map((result) => result.status).join(', '),
    )

    actAs(adminId)
    const createdA = await call<Skill>('POST', '/api/skills', { name: nameA, category: 'Пробная' })
    const createdB = await call<Skill>('POST', '/api/skills', { name: nameB, category: 'Пробная' })
    const idA = createdA.body.data?.id
    const idB = createdB.body.data?.id
    check('администратор заводит навыки: 201', createdA.status === 201 && createdB.status === 201)

    const dupCase = await call('POST', '/api/skills', { name: `  пробный   НАВЫК ${sfx} `, category: 'Пробная' })
    const dupSpaces = await call('POST', '/api/skills', { name: `ПробныйНавык${sfx}`, category: 'Пробная' })
    const dupRename = await call('PATCH', `/api/skills/${idB}`, { name: nameA.toUpperCase() })
    check(
      'дубль названия без учёта регистра и пробелов — 409 и при создании, и при переименовании',
      dupCase.status === 409 && dupSpaces.status === 409 && dupRename.status === 409 &&
        (dupCase.body.error?.message ?? '').includes(nameA),
      [dupCase.status, dupSpaces.status, dupRename.status].join(', '),
    )
    const ownCase = await call<Skill>('PATCH', `/api/skills/${idA}`, { name: nameA.toLowerCase() })
    await call('PATCH', `/api/skills/${idA}`, { name: nameA })
    check('своё название в другом регистре — не дубль: 200', ownCase.status === 200, `статус ${ownCase.status}`)

    // Решение 110: гонку держит база (индекс skills_name_key_ci), а не блокировка в коде.
    // Одновременные запросы проходят проверку в коде оба — второй останавливает индекс.
    type Created = Result<Skill>
    const raceName = `Пробная гонка ${sfx}`
    const raced: Created[] = await Promise.all(
      [raceName, `пробная ГОНКА ${sfx}`, `ПробнаяГонка${sfx}`, `  пробная   гонка ${sfx} `].map((name) =>
        call<Skill>('POST', '/api/skills', { name, category: 'Пробная' }),
      ),
    )
    const raceWinners = raced.filter((result) => result.status === 201)
    const raceLosers = raced.filter((result) => result.status === 409)
    const winnerName = raceWinners[0]?.body.data?.name ?? ''
    check(
      'четыре одновременных создания одного навыка в разном написании: ровно одно 201, остальные 409 с его названием',
      raceWinners.length === 1 &&
        raceLosers.length === 3 &&
        raceLosers.every(
          (result) => result.body.error?.code === 'CONFLICT' && (result.body.error.message ?? '').includes(`«${winnerName}»`),
        ),
      raced.map((result) => result.status).join(', '),
    )
    const raceId = raceWinners[0]?.body.data?.id
    if (raceId) await call('DELETE', `/api/skills/${raceId}`)

    const sharedName = `Пробный общий ${sfx}`
    const renames = await Promise.all([
      call<Skill>('PATCH', `/api/skills/${idA}`, { name: sharedName }),
      call<Skill>('PATCH', `/api/skills/${idB}`, { name: sharedName.toUpperCase().replaceAll(' ', '') }),
    ])
    check(
      'два одновременных переименования в одно название: одно 200, другое 409',
      renames.map((result) => result.status).sort().join() === '200,409',
      renames.map((result) => result.status).join(', '),
    )
    await call('PATCH', `/api/skills/${idA}`, { name: nameA })
    await call('PATCH', `/api/skills/${idB}`, { name: nameB })

    // Навыки — в программе-черновике и запланированном продукте: в аналитику они не входят,
    // и цифры сценария показа не сдвигаются.
    const drafts = await call<Array<{ id: string }>>('GET', '/api/programs?status=DRAFT&pageSize=1')
    const planned = await call<Array<{ id: string }>>('GET', '/api/products?status=PLANNED&pageSize=1')
    const programId = drafts.body.data?.[0]?.id
    const productId = planned.body.data?.[0]?.id

    if (!idA || !idB || !programId || !productId) {
      check('есть программа-черновик и запланированный продукт', false, 'запустите npm run db:seed')
    } else {
      const programBefore = (await call<ProgramCard>('GET', `/api/programs/${programId}`)).body.data?.skills ?? []
      const productBefore = (await call<ProductCard>('GET', `/api/products/${productId}`)).body.data?.skills ?? []
      const restoreProgram = programBefore.map(({ skillId, level, importance, source, confidence, comment }) => ({
        skillId, level, importance, source, confidence, comment,
      }))
      const restoreProduct = productBefore.map(({ skillId, relevance }) => ({ skillId, relevance }))

      const gapsBefore = await gapsDigest()
      const overviewBefore = await call<{ skillMatch: { coveragePercent: number | null } }>('GET', '/api/analytics/overview')
      const recsBefore = await call<unknown[]>('GET', '/api/recommendations?pageSize=1')

      await call('PUT', `/api/programs/${programId}/skills`, {
        skills: [
          ...restoreProgram,
          { skillId: idA, level: 'BASIC', importance: 'LOW' },
          { skillId: idB, level: 'ADVANCED', importance: 'HIGH', comment: 'из дубля' },
        ],
      })
      await call('PUT', `/api/products/${productId}/skills`, {
        skills: [...restoreProduct, { skillId: idB, relevance: 'CORE' }],
      })

      const usedDelete = await call<unknown>('DELETE', `/api/skills/${idA}`)
      const usage = (usedDelete.body.error?.details as { usage?: { programs: number } } | undefined)?.usage
      check(
        'удаление используемого навыка — 409 с объяснением, сколько где используется',
        usedDelete.status === 409 && usage?.programs === 1 && (usedDelete.body.error?.message ?? '').includes('в 1 программе'),
        `статус ${usedDelete.status}: ${usedDelete.body.error?.message ?? ''}`,
      )

      const self = await call('POST', `/api/skills/${idB}/merge`, { targetId: idB })
      const missing = await call('POST', `/api/skills/${idB}/merge`, { targetId: 'no-such-skill' })
      check('объединение с собой и с несуществующим — 422', self.status === 422 && missing.status === 422, `${self.status}, ${missing.status}`)

      type Merge = {
        target: Skill
        removed: { id: string; name: string }
        programs: { moved: number; combined: number }
        products: { moved: number; combined: number }
      }
      const merged = await call<Merge>('POST', `/api/skills/${idB}/merge`, { targetId: idA })
      check(
        'объединение: 200, связь программы объединена, продукта — перенесена',
        merged.status === 200 &&
          merged.body.data?.removed.name === nameB &&
          merged.body.data?.programs.combined === 1 &&
          merged.body.data?.products.moved === 1 &&
          merged.body.data?.target.programCount === 1 &&
          merged.body.data?.target.productCount === 1,
        `статус ${merged.status}: ${JSON.stringify(merged.body.data ?? merged.body.error)}`,
      )

      const programAfter = (await call<ProgramCard>('GET', `/api/programs/${programId}`)).body.data?.skills ?? []
      const productAfter = (await call<ProductCard>('GET', `/api/products/${productId}`)).body.data?.skills ?? []
      const linkA = programAfter.filter((row) => row.skillId === idA)
      check(
        'в программе одна связь — более сильная: продвинутый уровень, высокая важность',
        linkA.length === 1 && linkA[0]!.level === 'ADVANCED' && linkA[0]!.importance === 'HIGH' &&
          !programAfter.some((row) => row.skillId === idB),
        JSON.stringify(linkA),
      )
      check(
        'продукт даёт целевой навык со значимостью дубля, дубля нет',
        productAfter.some((row) => row.skillId === idA && row.relevance === 'CORE') &&
          !productAfter.some((row) => row.skillId === idB),
      )
      const goneB = await call('PATCH', `/api/skills/${idB}`, { category: 'Пробная' })
      const listed = await call<Skill[]>('GET', `/api/skills?q=${encodeURIComponent(sfx)}`)
      check(
        'дубль удалён: правка — 404, в справочнике остался один навык',
        goneB.status === 404 && (listed.body.data ?? []).map((row) => row.id).join() === idA,
        `статус ${goneB.status}, найдено ${(listed.body.data ?? []).length}`,
      )

      const gapsAfter = await gapsDigest()
      const gapsOfProgram = await call('GET', `/api/skills/gaps?programId=${programId}`)
      const overviewAfter = await call<{ skillMatch: { coveragePercent: number | null } }>('GET', '/api/analytics/overview')
      const recsAfter = await call<unknown[]>('GET', '/api/recommendations?pageSize=1')
      check(
        'аналитика после объединения не ломается: дефициты, покрытие и рекомендации те же',
        gapsOfProgram.status === 200 &&
          overviewAfter.status === 200 &&
          recsAfter.status === 200 &&
          gapsAfter === gapsBefore &&
          overviewAfter.body.data?.skillMatch.coveragePercent === overviewBefore.body.data?.skillMatch.coveragePercent &&
          recsAfter.body.meta?.total === recsBefore.body.meta?.total,
        `дефицитов ${gapsBefore.split(':')[0]} → ${gapsAfter.split(':')[0]}, ` +
          `рекомендаций ${String(recsBefore.body.meta?.total)} → ${String(recsAfter.body.meta?.total)}`,
      )

      const audit = await call<Array<{ action: string; objectId: string; payload: Record<string, unknown> | null }>>(
        'GET',
        `/api/audit?action=skill.merge&objectId=${idA}`,
      )
      check(
        'объединение — в журнале, с названием удалённого дубля',
        (audit.body.data ?? []).some((row) => row.payload?.removedName === nameB),
      )

      // Возврат программы и продукта к прежнему составу, затем удаление неиспользуемого.
      await call('PUT', `/api/programs/${programId}/skills`, { skills: restoreProgram })
      await call('PUT', `/api/products/${productId}/skills`, { skills: restoreProduct })
      const unusedDelete = await call<{ id: string }>('DELETE', `/api/skills/${idA}`)
      const afterDelete = await call<Skill[]>('GET', `/api/skills?q=${encodeURIComponent(sfx)}`)
      check(
        'неиспользуемый навык удаляется: 200, в справочнике его больше нет',
        unusedDelete.status === 200 && unusedDelete.body.data?.id === idA && (afterDelete.body.data ?? []).length === 0,
        `статус ${unusedDelete.status}`,
      )
    }
    actAs(null)
  }
}

/**
 * Решение 110: один ключ названия навыка везде — в справочнике, при загрузке рыночных
 * данных и в тексте рекомендаций после объединения. Демо-навыки трогаются временно
 * и возвращаются как были (название, категория, описание, связи, текст рекомендации);
 * меняется только id навыка из сценария объединения — сид его не фиксирует.
 */
async function checkSkillNameConsistency(ctx: ProbeContext): Promise<void> {
  step('Навык по ключу названия: загрузка рыночных данных и текст рекомендаций после объединения')
  const { adminId } = ctx
  if (!adminId) {
    check('демо-данные готовы (администратор)', false, 'запустите npm run db:seed')
    return
  }
  actAs(adminId)
  type Skill = { id: string; name: string; category: string; description: string | null }
  const findSkill = async (name: string) =>
    (await call<Skill[]>('GET', `/api/skills?q=${encodeURIComponent(name)}&pageSize=50`)).body.data?.find(
      (row) => row.name === name,
    )

  // ── Загрузка: источник пишет «Сетевые технологии», в справочнике — другим регистром и слитно.
  const importName = 'Сетевые технологии'
  const imported = await findSkill(importName)
  if (!imported) {
    check(`в демо-справочнике есть навык «${importName}»`, false, 'запустите npm run db:seed')
  } else {
    const renamed = await call<Skill>('PATCH', `/api/skills/${imported.id}`, { name: 'СЕТЕВЫЕТехнологии' })
    try {
      type Sync = { imported: number; updated: number; unknownSkills: string[] }
      // Демонстрационный источник за 2026-Q1 отдаёт ровно значения сида: данные не меняются.
      const sync = await call<Sync>('POST', '/api/data-sources/sync', {})
      check(
        'своё название другим регистром и без пробела — 200 (тот же навык)',
        renamed.status === 200,
        `статус ${renamed.status}`,
      )
      check(
        'загрузка сопоставляет «Сетевые технологии» с «СЕТЕВЫЕТехнологии»: неизвестных нет, новых строк нет',
        sync.status === 200 &&
          (sync.body.data?.unknownSkills ?? ['?']).length === 0 &&
          sync.body.data?.imported === 0 &&
          (sync.body.data?.updated ?? 0) > 0,
        `статус ${sync.status}: ${JSON.stringify(sync.body.data ?? sync.body.error)}`,
      )
    } finally {
      await call('PATCH', `/api/skills/${imported.id}`, { name: imported.name })
    }
  }

  // ── Объединение: рекомендация дубля переходит к целевому навыку и называет его.
  type Rec = {
    id: string
    ruleKey: string
    title: string
    description: string
    relatedData: { skillId?: string } | null
    target: { objectType: string; objectId: string }
  }
  const recs = await call<Rec[]>('GET', '/api/recommendations?pageSize=100')
  const rec = (recs.body.data ?? []).find((row) => row.ruleKey === 'skill.critical-gap-with-product')
  const source = rec ? (await call<Skill[]>('GET', `/api/skills?pageSize=100`)).body.data?.find((row) => row.id === rec.target.objectId) : undefined
  if (!rec || !source) {
    check('в демо-наборе есть рекомендация по дефициту навыка', false, 'запустите npm run db:seed')
    actAs(null)
    return
  }

  const targetName = `Пробная цель ${Date.now().toString().slice(-6)}`
  const target = await call<Skill>('POST', '/api/skills', { name: targetName, category: source.category })
  const targetId = target.body.data?.id
  if (!targetId) {
    check('пробный целевой навык заведён', false, `статус ${target.status}`)
    actAs(null)
    return
  }
  let merged = false
  try {
    type Merge = { recommendations: { moved: number; dropped: number } }
    const merge = await call<Merge>('POST', `/api/skills/${source.id}/merge`, { targetId })
    merged = merge.status === 200
    const after = await call<Rec>('GET', `/api/recommendations/${rec.id}`)
    const text = `${after.body.data?.title ?? ''} ${after.body.data?.description ?? ''}`
    check(
      'после объединения рекомендация называет целевой навык и ссылается на него',
      merged &&
        merge.body.data?.recommendations.moved === 1 &&
        after.body.data?.title === `Дефицит навыка «${targetName}» закрывается нашим продуктом` &&
        text.includes(`навык «${targetName}»`) &&
        !text.includes(`«${source.name}»`) &&
        after.body.data?.target.objectId === targetId &&
        after.body.data?.relatedData?.skillId === targetId,
      `статус ${merge.status}: ${after.body.data?.title ?? JSON.stringify(merge.body.error)}`,
    )
  } finally {
    // Целевой навык становится прежним демо-навыком: название, категория, описание.
    // Переименование переписывает текст рекомендации обратно в той же транзакции.
    if (merged) {
      await call('PATCH', `/api/skills/${targetId}`, {
        name: source.name,
        category: source.category,
        description: source.description,
      })
    } else {
      await call('DELETE', `/api/skills/${targetId}`)
    }
  }
  const restored = await call<Rec>('GET', `/api/recommendations/${rec.id}`)
  check(
    'переименование навыка возвращает прежний текст рекомендации',
    restored.body.data?.title === rec.title && restored.body.data?.description === rec.description,
    restored.body.data?.title ?? `статус ${restored.status}`,
  )
  actAs(null)
}

async function checkContactPrivacy(ctx: ProbeContext): Promise<void> {
  step('Почта и телефон контактов вузов: аналитику и наблюдателю — «скрыто», поиском не достать')
  const { rep, adminId, universities, managerId } = ctx

  type Contact = {
    fullName: string
    position: string | null
    email: string | null
    phone: string | null
    contactDetailsHidden: boolean
  }
  type Card = { id: string; contacts: Contact[] }
  type SearchBody = { groups: Array<{ type: string; items: Array<{ id: string }> }> }
  const firstId = async (role: string): Promise<string | null> =>
    (await call<Array<{ id: string }>>('GET', `/api/users?role=${role}&pageSize=1`)).body.data?.[0]?.id ?? null

  actAs(adminId)
  const analystId = await firstId('ANALYST')
  const viewerId = await firstId('VIEWER')
  // Вуз представителя: на нём заодно видно, что свой вуз представитель видит как раньше.
  const universityId = rep?.universityId ?? universities.body.data?.[0]?.id ?? null
  const adminCard = universityId ? await call<Card>('GET', `/api/universities/${universityId}`) : null
  const withDetails = adminCard?.body.data?.contacts.find((contact) => contact.email && contact.phone)
  check('у вуза есть контакт с почтой и телефоном (демо-данные)', Boolean(withDetails))

  if (universityId && withDetails?.email && withDetails.phone) {
    const email = withDetails.email
    const phone = withDetails.phone

    for (const [role, id] of [['ANALYST', analystId], ['VIEWER', viewerId]] as const) {
      actAs(id)
      const card = await call<Card>('GET', `/api/universities/${universityId}`)
      const contact = card.body.data?.contacts.find((item) => item.fullName === withDetails.fullName)
      check(
        `${role}: карточка открывается, ФИО и должность на месте`,
        card.status === 200 && contact?.position === withDetails.position,
      )
      check(
        `${role}: почта и телефон — null, признак «скрыто»`,
        contact?.email === null && contact.phone === null && contact.contactDetailsHidden === true,
      )
      check(`${role}: ни почты, ни телефона нигде в ответе`, !card.raw.includes(email) && !card.raw.includes(phone))

      const found = await call<SearchBody>('GET', `/api/search?q=${encodeURIComponent(email)}`)
      const hits = (found.body.data?.groups ?? []).reduce((sum, group) => sum + group.items.length, 0)
      check(`${role}: поиск по почте контакта ничего не находит`, found.status === 200 && hits === 0, `находок ${hits}`)
      const registry = await call<unknown[]>(
        'GET',
        `/api/universities?withRating=false&q=${encodeURIComponent(email)}`,
      )
      check(`${role}: реестр по почте контакта пуст`, registry.status === 200 && registry.body.meta?.total === 0)

      const me = await call<{ permissions: { canSeeContactDetails: boolean } }>('GET', '/api/me')
      check(`${role}: /api/me — canSeeContactDetails: false`, me.body.data?.permissions.canSeeContactDetails === false)
    }

    actAs(managerId)
    const managerCard = await call<Card>('GET', `/api/universities/${universityId}`)
    const managerContact = managerCard.body.data?.contacts.find((item) => item.fullName === withDetails.fullName)
    check(
      'MANAGER: почта и телефон видны, признака нет',
      managerContact?.email === email && managerContact.phone === phone && managerContact.contactDetailsHidden === false,
    )
    const managerMe = await call<{ permissions: { canSeeContactDetails: boolean } }>('GET', '/api/me')
    check('MANAGER: /api/me — canSeeContactDetails: true', managerMe.body.data?.permissions.canSeeContactDetails === true)

    if (rep?.universityId === universityId) {
      actAs(rep.id)
      const repCard = await call<Card>('GET', `/api/universities/${universityId}`)
      const repContact = repCard.body.data?.contacts.find((item) => item.fullName === withDetails.fullName)
      check(
        'UNIVERSITY_REP: контакты своего вуза видны как раньше',
        repContact?.email === email && repContact.phone === phone && repContact.contactDetailsHidden === false,
      )
    }

    // Выгрузка: почта контакта — только ADMIN и MANAGER, как и была (аудит S-17).
    actAs(viewerId)
    const exported = await call<unknown>('GET', '/api/export?dataset=universities&limit=100')
    check('VIEWER: в выгрузке вузов почты контакта нет', exported.status === 200 && !exported.raw.includes(email))
  }
  actAs(null)
}

async function checkContactLegalBasis(ctx: ProbeContext): Promise<void> {
  step('Основание обработки ПД контактов и согласие: права, отзыв → обезличивание, история (решение 111)')
  const { rep, adminId, managerId, universities } = ctx

  type LegalBasis = {
    basis: string
    consentStatus: string
    consentObtainedAt: string | null
    consentForm: string | null
    documentReference: string
    withdrawalReference: string | null
  }
  type Contact = {
    id: string
    fullName: string
    email: string | null
    isAnonymized: boolean
    isPrimary: boolean
    basisRecorded: boolean
    legalBasis: LegalBasis | null
  }
  type Card = { id: string; contacts: Contact[] }
  type HistoryEntry = { kind: string; toConsentStatus: string; anonymized: boolean; referenceChanged: boolean }
  const firstId = async (role: string): Promise<string | null> =>
    (await call<Array<{ id: string }>>('GET', `/api/users?role=${role}&pageSize=1`)).body.data?.[0]?.id ?? null

  actAs(adminId)
  const analystId = await firstId('ANALYST')
  const viewerId = await firstId('VIEWER')

  // Демо-вуз представителя: основание зафиксировано по соглашению с вузом (сид).
  const demoUniversityId = rep?.universityId ?? universities.body.data?.[0]?.id ?? null
  actAs(managerId)
  const managerDemo = demoUniversityId ? await call<Card>('GET', `/api/universities/${demoUniversityId}`) : null
  const demoContact = managerDemo?.body.data?.contacts.find((contact) => contact.basisRecorded)
  check(
    'MANAGER: в карточке демо-вуза основание контакта видно целиком',
    Boolean(demoContact?.legalBasis?.basis && demoContact.legalBasis.documentReference),
    demoContact?.legalBasis?.basis ?? 'нет',
  )
  const demoReference = demoContact?.legalBasis?.documentReference ?? '—'

  for (const [role, id] of [['ANALYST', analystId], ['VIEWER', viewerId], ['UNIVERSITY_REP', rep?.id ?? null]] as const) {
    actAs(id)
    const card = demoUniversityId ? await call<Card>('GET', `/api/universities/${demoUniversityId}`) : null
    const contact = card?.body.data?.contacts.find((item) => item.id === demoContact?.id)
    check(
      `${role}: только признак «основание зафиксировано», без основания и документа`,
      card?.status === 200 &&
        contact?.basisRecorded === true &&
        contact.legalBasis === null &&
        !card.raw.includes(demoReference),
    )
  }

  // Свой контакт в своём вузе: демо-контакты пробник не обезличивает.
  actAs(adminId)
  const sfx = Date.now().toString().slice(-6)
  const probeName = `Пробная Персона Согласия ${sfx}`
  const probeEmail = `probe-consent-${sfx}@example.invalid`
  const created = await call<Card>('POST', '/api/universities', {
    name: `Пробный вуз учёта согласий ${sfx}`,
    city: 'Тверь',
    region: 'Тверская область',
    contacts: [{ fullName: probeName, position: 'Методист', email: probeEmail, phone: '+7 900 000-00-01', isPrimary: true }],
  })
  const universityId = created.body.data?.id
  const contactId = created.body.data?.contacts[0]?.id
  check('заведён пробный вуз с контактом без основания', created.status === 201 && created.body.data?.contacts[0]?.basisRecorded === false)
  if (!universityId || !contactId) {
    actAs(null)
    return
  }
  const base = `/api/universities/${universityId}/contacts/${contactId}`
  const consentBody = {
    basis: 'CONSENT',
    documentReference: `Согласие вх. № ${sfx} (проба)`,
    consentObtainedAt: new Date(Date.now() - 86_400_000).toISOString(),
    consentForm: 'WRITTEN',
  }

  for (const [role, id] of [['ANALYST', analystId], ['VIEWER', viewerId], ['UNIVERSITY_REP', rep?.id ?? null]] as const) {
    actAs(id)
    const set = await call('PUT', `${base}/legal-basis`, consentBody)
    const withdraw = await call('POST', `${base}/consent/withdraw`, { withdrawalReference: 'Отзыв (проба)' })
    const history = await call('GET', `${base}/legal-basis/history`)
    // Представителю чужой вуз и так закрыт, но отказ по праву наступает раньше поиска.
    check(
      `${role}: зафиксировать, отозвать, история — 403`,
      set.status === 403 && withdraw.status === 403 && history.status === 403,
      `${set.status}/${withdraw.status}/${history.status}`,
    )
  }

  actAs(managerId)
  const noDate = await call('PUT', `${base}/legal-basis`, { basis: 'CONSENT', documentReference: 'Согласие (проба)' })
  check('согласие без даты и формы — 422', noDate.status === 422)
  const future = await call('PUT', `${base}/legal-basis`, {
    ...consentBody,
    consentObtainedAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  })
  check('дата согласия в будущем — 422', future.status === 422)
  const formWithoutConsent = await call('PUT', `${base}/legal-basis`, {
    basis: 'LEGITIMATE_INTEREST',
    documentReference: 'Соглашение (проба)',
    consentForm: 'WRITTEN',
  })
  check('форма согласия при другом основании — 422', formWithoutConsent.status === 422)
  const noReference = await call('PUT', `${base}/legal-basis`, { basis: 'LEGITIMATE_INTEREST', documentReference: ' ' })
  check('без документа-основания — 422', noReference.status === 422)
  const withdrawNothing = await call('POST', `${base}/consent/withdraw`, { withdrawalReference: 'Отзыв (проба)' })
  check('отзыв без согласия — 409', withdrawNothing.status === 409, `статус ${withdrawNothing.status}`)

  const set = await call<Contact>('PUT', `${base}/legal-basis`, consentBody)
  check(
    'MANAGER фиксирует согласие: OBTAINED, дата и форма',
    set.status === 200 &&
      set.body.data?.legalBasis?.consentStatus === 'OBTAINED' &&
      set.body.data.legalBasis.consentForm === 'WRITTEN' &&
      set.body.data.basisRecorded === true,
    `статус ${set.status}`,
  )
  const again = await call<Contact>('PUT', `${base}/legal-basis`, consentBody)
  const afterRepeat = await call<HistoryEntry[]>('GET', `${base}/legal-basis/history`)
  check('повтор той же формы — 200 и без новой записи истории', again.status === 200 && afterRepeat.body.meta?.total === 1)

  const foreignUniversityId = demoUniversityId !== universityId ? demoUniversityId : null
  if (foreignUniversityId) {
    const foreign = await call('PUT', `/api/universities/${foreignUniversityId}/contacts/${contactId}/legal-basis`, consentBody)
    check('контакт под адресом чужого вуза — 404', foreign.status === 404, `статус ${foreign.status}`)
  }

  const noWithdrawalDoc = await call('POST', `${base}/consent/withdraw`, {})
  check('отзыв без документа отзыва — 422', noWithdrawalDoc.status === 422)
  const withdrawn = await call<Contact>('POST', `${base}/consent/withdraw`, { withdrawalReference: `Отзыв вх. № ${sfx} (проба)` })
  check(
    'отзыв согласия → контакт обезличен сразу',
    withdrawn.status === 200 &&
      withdrawn.body.data?.isAnonymized === true &&
      withdrawn.body.data.email === null &&
      withdrawn.body.data.isPrimary === false &&
      withdrawn.body.data.legalBasis?.consentStatus === 'WITHDRAWN',
    `статус ${withdrawn.status}`,
  )
  const card = await call<Card>('GET', `/api/universities/${universityId}`)
  check('в карточке вуза нет ни ФИО, ни почты отозвавшего', !card.raw.includes(probeName) && !card.raw.includes(probeEmail))
  const repeat = await call<Contact>('POST', `${base}/consent/withdraw`, { withdrawalReference: `Отзыв вх. № ${sfx} (проба)` })
  check('повторный отзыв — тот же результат', repeat.status === 200 && repeat.body.data?.isAnonymized === true)
  const reset = await call('PUT', `${base}/legal-basis`, { basis: 'LEGITIMATE_INTEREST', documentReference: 'Соглашение (проба)' })
  check('основание после отзыва не меняется — 409', reset.status === 409, `статус ${reset.status}`)

  const history = await call<HistoryEntry[]>('GET', `${base}/legal-basis/history`)
  const [last, first] = history.body.data ?? []
  check(
    'история: отзыв с обезличиванием сверху, под ним фиксация согласия',
    history.body.meta?.total === 2 &&
      last?.kind === 'consent.withdraw' && last.anonymized === true && last.toConsentStatus === 'WITHDRAWN' &&
      first?.kind === 'basis.set' && first.toConsentStatus === 'OBTAINED',
  )
  check('в истории нет ни ФИО, ни почты, ни текста документов', !history.raw.includes(probeName) && !history.raw.includes(probeEmail) && !history.raw.includes('(проба)'))

  actAs(adminId)
  const journal = await call<Array<{ action: string }>>('GET', `/api/audit?objectType=Contact&objectId=${contactId}&pageSize=20`)
  const actions = (journal.body.data ?? []).map((entry) => entry.action).sort()
  check(
    'журнал: основание, отзыв и обезличивание — по одному разу',
    JSON.stringify(actions) === JSON.stringify(['contact.anonymize', 'contact.basis.set', 'contact.consent.withdraw']),
    actions.join(', '),
  )
  check('в журнале нет ни ФИО, ни почты, ни текста документов', !journal.raw.includes(probeName) && !journal.raw.includes(probeEmail) && !journal.raw.includes('(проба)'))

  const exported = await call<unknown>('GET', '/api/export?dataset=universities&limit=100')
  check('выгрузка вузов: колонка «Основание обработки ПД зафиксировано»', exported.raw.includes('Основание обработки ПД зафиксировано'))

  await call('POST', `/api/universities/${universityId}/archive`)
  actAs(null)
}

/**
 * Вход по паролю тем же путём, что у smoke.ts и у экрана входа: csrf-токен
 * и форма в NextAuth. Возвращает cookie сессии или null, если вход не принят.
 * Своё хранилище cookie на каждую попытку: демо-cookie пробника сюда не идёт.
 */
async function passwordLogin(email: string, password: string): Promise<string | null> {
  const csrf = await fetch(`${BASE_URL}/api/auth/csrf`)
  const csrfCookie = (csrf.headers.getSetCookie?.() ?? []).map((line) => line.split(';')[0]).join('; ')
  const { csrfToken } = (await csrf.json()) as { csrfToken: string }
  const response = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: csrfCookie },
    body: new URLSearchParams({ csrfToken, email, password }).toString(),
  })
  return sessionCookieFrom(response)
}

/** Новая cookie сессии из ответа (вход, переоформление) — или null, если сервер её не выдал. */
function sessionCookieFrom(response: Response): string | null {
  const session = (response.headers.getSetCookie?.() ?? [])
    .map((line) => line.split(';')[0]!)
    .find((pair) => /session-token=./.test(pair))
  return session ?? null
}

/**
 * Запрос под настоящей сессией, без демо-cookie. `session` — cookie, которую сервер
 * выдал взамен (смена своего пароля переоформляет сессию, решение 109).
 */
async function asSession<T>(
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Result<T> & { session: string | null }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const raw = await response.text()
  let parsed: Result<T>['body'] = {}
  try {
    parsed = raw ? JSON.parse(raw) : {}
  } catch {
    parsed = {}
  }
  return { status: response.status, body: parsed, raw, session: sessionCookieFrom(response) }
}

async function checkUserManagement(ctx: ProbeContext): Promise<void> {
  step('Пользователи: временный пароль, смена пароля, блокировка — и права администратора')
  const { rep, adminId, managerId } = ctx

  if (!adminId || !managerId || !rep) {
    check('демо-данные готовы (администратор, менеджер, представитель вуза)', false, 'запустите npm run db:seed')
  } else {
    // Отказ всем, кроме администратора, — на каждом новом маршруте администратора.
    const adminOnly: Array<[string, string, unknown]> = [
      ['POST', '/api/users', { email: 'x@example.invalid', fullName: 'Проба Прав', role: 'VIEWER' }],
      ['GET', `/api/users/${managerId}`, undefined],
      ['PATCH', `/api/users/${managerId}`, { position: 'Проба прав' }],
      ['POST', `/api/users/${managerId}/password-reset`, undefined],
    ]
    for (const actor of [managerId, rep.id]) {
      actAs(actor)
      for (const [method, path, body] of adminOnly) {
        const result = await call(method, path, body)
        check(
          `${actor === managerId ? 'менеджеру' : 'представителю вуза'}: ${method} ${path.replace(managerId, ':id')} — 403`,
          result.status === 403,
          `статус ${result.status}`,
        )
      }
    }

    // Маршрут смены пароля представителю открыт (не 403), но демо-представитель — общая
    // учётка стенда: её пароль не меняется (409), чтобы один проверяющий не закрыл вход другим.
    actAs(rep.id)
    const repChange = await call<unknown>('POST', '/api/me/password', {
      currentPassword: 'заведомо-неверный-текущий',
      newPassword: 'новый-пароль-представителя',
    })
    check(
      'демо-представитель: пароль общей учётки не меняется — 409, а не 403',
      repChange.status === 409 && repChange.raw.includes('общая демо-учётная запись'),
      `статус ${repChange.status}`,
    )

    // Общие демо-учётки не меняет и администратор: ни пароль, ни доступ, ни данные.
    actAs(adminId)
    for (const [method, path, body] of [
      ['POST', `/api/users/${managerId}/password-reset`, undefined],
      ['PATCH', `/api/users/${managerId}`, { isActive: false }],
      ['PATCH', `/api/users/${managerId}`, { position: 'Проба' }],
    ] as Array<[string, string, unknown]>) {
      const result = await call(method, path, body)
      check(
        `администратор: ${method} общей демо-учётки менеджера — 409`,
        result.status === 409,
        `статус ${result.status}`,
      )
    }

    // Администратор заводит пользователя: пароль в ответе один раз, кэш запрещён.
    actAs(adminId)
    const email = `probe-user-${Date.now()}@example.invalid`
    const createdResponse = await fetch(`${BASE_URL}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `skilllink_user=${adminId}` },
      body: JSON.stringify({ email: email.toUpperCase(), fullName: 'Пробный Сотрудник Пробникович', role: 'VIEWER' }),
    })
    const created = (await createdResponse.json()) as {
      data?: { user: { id: string; email: string | null }; temporaryPassword: string }
    }
    const newUser = created.data?.user
    const temporary = created.data?.temporaryPassword ?? ''
    check('администратор заводит пользователя — 201', createdResponse.status === 201, `статус ${createdResponse.status}`)
    check('почта сохранена в нижнем регистре', newUser?.email === email, newUser?.email ?? '')
    check(
      'временный пароль — 14 знаков без похожих букв',
      /^[A-HJKMNP-Za-hjkmnp-z2-9]{14}$/.test(temporary),
      `${temporary.length} знаков`,
    )
    check('ответ с паролем не кэшируется', createdResponse.headers.get('cache-control') === 'no-store', createdResponse.headers.get('cache-control') ?? '')

    const duplicate = await call('POST', '/api/users', { email, fullName: 'Дубль Дублевич', role: 'VIEWER' })
    check('та же почта второй раз — 409', duplicate.status === 409, `статус ${duplicate.status}`)

    if (newUser) {
      const userAudit = await call<Array<{ action: string }>>('GET', `/api/audit?objectType=User&objectId=${newUser.id}`)
      check(
        'в журнале заведение есть, пароля и почты нет',
        (userAudit.body.data ?? []).some((entry) => entry.action === 'user.create') &&
          !userAudit.raw.includes(temporary) &&
          !userAudit.raw.includes(email),
      )

      // Вход по временному паролю — тем же входом NextAuth.
      const firstSession = await passwordLogin(email, temporary)
      check('вход по временному паролю принят', firstSession !== null)
      if (firstSession) {
        const me = await asSession<{ id: string; passwordTemporary: boolean }>(firstSession, 'GET', '/api/me')
        check('сессия — от имени нового пользователя', me.body.data?.id === newUser.id)
        check('кабинет знает, что пароль временный', me.body.data?.passwordTemporary === true)

        const wrong = await asSession(firstSession, 'POST', '/api/me/password', {
          currentPassword: 'не-тот-пароль',
          newPassword: 'собственный-пароль-1',
        })
        check('неверный текущий пароль — 422', wrong.status === 422, `статус ${wrong.status}`)
        const asEmail = await asSession(firstSession, 'POST', '/api/me/password', {
          currentPassword: temporary,
          newPassword: email,
        })
        check('новый пароль, равный почте, — 422', asEmail.status === 422, `статус ${asEmail.status}`)
        const short = await asSession(firstSession, 'POST', '/api/me/password', {
          currentPassword: temporary,
          newPassword: 'коротко',
        })
        check('новый пароль короче 10 символов — 422', short.status === 422, `статус ${short.status}`)

        const OWN = 'собственный-пароль-1'
        const changed = await asSession(firstSession, 'POST', '/api/me/password', {
          currentPassword: temporary,
          newPassword: OWN,
        })
        check('пароль сменён — 200', changed.status === 200, `статус ${changed.status}`)
        // Смена пароля закрывает прежние сессии; текущую сервер переоформил новой cookie.
        const afterChange = await asSession<{ passwordTemporary: boolean }>(changed.session ?? firstSession, 'GET', '/api/me')
        check('после смены пароль больше не временный', afterChange.body.data?.passwordTemporary === false)
        check('журнал без пароля', !(await call('GET', `/api/audit?objectId=${newUser.id}`)).raw.includes(OWN))

        check('старый (временный) пароль больше не подходит', (await passwordLogin(email, temporary)) === null)
        const ownSession = await passwordLogin(email, OWN)
        check('новый пароль подходит', ownSession !== null)

        // Блокировка: вход и уже выданная сессия перестают работать сразу.
        const blocked = await call<{ isActive: boolean }>('PATCH', `/api/users/${newUser.id}`, { isActive: false })
        check('администратор блокирует — 200', blocked.status === 200 && blocked.body.data?.isActive === false)
        if (ownSession) {
          // В демо-режиме запрос без действующей сессии уходит к демо-пользователю,
          // поэтому проверяется не код ответа, а то, от чьего имени он дан.
          const meBlocked = await asSession<{ id: string }>(ownSession, 'GET', '/api/me')
          check(
            'выданная сессия заблокированного больше не действует',
            meBlocked.status === 401 || meBlocked.body.data?.id !== newUser.id,
            `статус ${meBlocked.status}`,
          )
        }
        check('заблокированный не входит и с верным паролем', (await passwordLogin(email, OWN)) === null)

        const unblocked = await call<{ isActive: boolean }>('PATCH', `/api/users/${newUser.id}`, { isActive: true })
        check('администратор разблокирует — 200', unblocked.status === 200 && unblocked.body.data?.isActive === true)
        check('после разблокировки вход снова работает', (await passwordLogin(email, OWN)) !== null)

        // Новый временный пароль: старый перестаёт подходить.
        const reset = await call<{ temporaryPassword: string }>('POST', `/api/users/${newUser.id}/password-reset`)
        const resetPassword = reset.body.data?.temporaryPassword ?? ''
        check('новый временный пароль выдан — 200', reset.status === 200 && resetPassword.length === 14)
        check('после сброса новый временный подходит', (await passwordLogin(email, resetPassword)) !== null)
        check('после сброса прежний пароль не подходит', (await passwordLogin(email, OWN)) === null)

        const roleAudit = await call<Array<{ action: string }>>('GET', `/api/audit?objectType=User&objectId=${newUser.id}&pageSize=50`)
        const actions = new Set((roleAudit.body.data ?? []).map((entry) => entry.action))
        check(
          'журнал: заведение, смена пароля, блокировка, разблокировка, сброс',
          ['user.create', 'user.password.change', 'user.block', 'user.unblock', 'user.password.reset'].every((action) =>
            actions.has(action),
          ),
          [...actions].join(', '),
        )
      }
    }

    // Защиты администратора.
    const selfBlock = await call('PATCH', `/api/users/${adminId}`, { isActive: false })
    check('администратор не блокирует себя — 409', selfBlock.status === 409, `статус ${selfBlock.status}`)
    const selfDemote = await call('PATCH', `/api/users/${adminId}`, { role: 'MANAGER' })
    check('администратор не снимает с себя роль — 409', selfDemote.status === 409, `статус ${selfDemote.status}`)
    // Правила смены роли — на заведённом менеджере: общие демо-учётки не меняются (409).
    const handover = await call<{ user: { id: string } }>('POST', '/api/users', {
      email: `probe-manager-${Date.now()}@example.invalid`,
      fullName: 'Пробный Менеджер Передачи',
      role: 'MANAGER',
    })
    const handoverId = handover.body.data?.user.id
    const openCooperation = (
      await call<Array<{ id: string }>>('GET', '/api/cooperations?status=ACTIVE&pageSize=1')
    ).body.data?.[0]?.id
    if (handoverId && openCooperation) {
      const before = (
        await call<{ responsible?: { id: string } | null }>('GET', `/api/cooperations/${openCooperation}`)
      ).body.data?.responsible?.id
      await call('PATCH', `/api/cooperations/${openCooperation}`, { responsibleId: handoverId })
      const demote = await call<unknown>('PATCH', `/api/users/${handoverId}`, { role: 'ANALYST' })
      check(
        'менеджера с открытыми связками не перевести в аналитика — 409 «сначала передайте связки»',
        demote.status === 409 && demote.raw.includes('Сначала передайте связки'),
        `статус ${demote.status}`,
      )
      if (before) await call('PATCH', `/api/cooperations/${openCooperation}`, { responsibleId: before })
      const repWithoutUniversity = await call('PATCH', `/api/users/${handoverId}`, { role: 'UNIVERSITY_REP' })
      check('представитель без вуза — 422', repWithoutUniversity.status === 422, `статус ${repWithoutUniversity.status}`)
    } else {
      check('для проверки передачи связок есть менеджер и открытая связка', false, 'нужен npm run db:seed')
    }

    // Журнал: этап ведёт на свою связку; статус ИИ — без ключей.
    const stageAudit = await call<Array<{ cooperationId: string | null }>>(
      'GET',
      '/api/audit?objectType=WorkflowStage&pageSize=5',
    )
    check(
      'запись журнала об этапе знает свою связку',
      (stageAudit.body.data ?? []).length > 0 && (stageAudit.body.data ?? []).every((entry) => entry.cooperationId),
    )
    const integrations = await call<{ aiAssist?: { provider: string; ready: boolean } }>('GET', '/api/integrations/status')
    check(
      'в состоянии интеграций есть ИИ-помощник',
      typeof integrations.body.data?.aiAssist?.provider === 'string' &&
        typeof integrations.body.data?.aiAssist?.ready === 'boolean',
    )
    actAs(null)
  }
}

/**
 * Отзыв выданных сессий (решение 109): сессия, полученная до смены пароля, сброса,
 * смены роли или блокировки, больше не действует — 401 на /api/me, и в демо-режиме
 * не превращается в демо-пользователя. Всё — на заведённом пользователе: общие
 * демо-учётки этими действиями не меняются.
 */
async function checkSessionRevocation(ctx: ProbeContext): Promise<void> {
  step('Отзыв сессий: смена и сброс пароля, смена роли, блокировка')
  const { adminId } = ctx
  if (!adminId) {
    check('демо-данные готовы (администратор)', false, 'запустите npm run db:seed')
    return
  }

  actAs(adminId)
  const email = `probe-session-${Date.now()}@example.invalid`
  const created = await call<{ user: { id: string }; temporaryPassword: string }>('POST', '/api/users', {
    email,
    fullName: 'Пробный Сеанс Пробникович',
    role: 'VIEWER',
  })
  const userId = created.body.data?.user.id
  const temporary = created.body.data?.temporaryPassword ?? ''
  if (!userId) {
    check('пробный пользователь заведён', false, `статус ${created.status}`)
    actAs(null)
    return
  }

  const me = (cookie: string | null) =>
    asSession<{ id: string; role: string }>(cookie ?? 'authjs.session-token=нет', 'GET', '/api/me')
  const alive = async (cookie: string | null) => {
    const result = await me(cookie)
    return result.status === 200 && result.body.data?.id === userId
  }

  // 1. Смена своего пароля: другие сессии выходят, текущая переоформляется.
  const earlier = await passwordLogin(email, temporary)
  const current = await passwordLogin(email, temporary)
  check('две сессии до смены пароля действуют', (await alive(earlier)) && (await alive(current)))
  const OWN = 'сеансовый-пароль-2026'
  const changed = current
    ? await asSession<{ sessionRenewed: boolean }>(current, 'POST', '/api/me/password', {
        currentPassword: temporary,
        newPassword: OWN,
      })
    : null
  check(
    'пароль сменён — 200, текущая сессия переоформлена новой cookie',
    changed?.status === 200 && changed.body.data?.sessionRenewed === true && changed.session !== null,
    `статус ${changed?.status}`,
  )
  const earlierAfter = await me(earlier)
  check('сессия, полученная до смены пароля, — 401 на /api/me', earlierAfter.status === 401, `статус ${earlierAfter.status}`)
  check(
    '401 — единым форматом с понятным текстом',
    earlierAfter.body.error?.code === 'UNAUTHORIZED' && earlierAfter.raw.includes('Войдите заново'),
    earlierAfter.body.error?.message ?? '',
  )
  check('сменивший пароль остаётся в системе с новой cookie', await alive(changed?.session ?? null))
  check('его прежняя cookie (до переоформления) — 401', (await me(current)).status === 401)

  // Клиент сам версию не поднимет: обновление сессии без подписи сервера ничего не меняет.
  if (earlier) {
    const csrf = await fetch(`${BASE_URL}/api/auth/csrf`)
    const csrfCookie = (csrf.headers.getSetCookie?.() ?? []).map((line) => line.split(';')[0]).join('; ')
    const { csrfToken } = (await csrf.json()) as { csrfToken: string }
    const forged = await fetch(`${BASE_URL}/api/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `${csrfCookie}; ${earlier}` },
      body: JSON.stringify({
        csrfToken,
        data: { sessionVersion: 1, user: { sessionVersion: 1 }, sessionRenewal: 'поддельное.разрешение' },
      }),
    })
    const forgedCookie = sessionCookieFrom(forged)
    check(
      'отозванная сессия не продлевает себя сама через /api/auth/session',
      (await me(forgedCookie ?? earlier)).status === 401,
      `обновление: ${forged.status}`,
    )
  }

  // 2. Сброс пароля администратором.
  const beforeReset = await passwordLogin(email, OWN)
  check('вход с новым паролем', await alive(beforeReset))
  actAs(adminId)
  const reset = await call<{ temporaryPassword: string }>('POST', `/api/users/${userId}/password-reset`)
  const resetPassword = reset.body.data?.temporaryPassword ?? ''
  const beforeResetAfter = await me(beforeReset)
  check(
    'сброс пароля администратором: выданная сессия — 401',
    reset.status === 200 && beforeResetAfter.status === 401,
    `${reset.status}, ${beforeResetAfter.status}`,
  )
  check('и переоформленная после смены пароля — тоже 401', (await me(changed?.session ?? null)).status === 401)

  // 3. Смена роли.
  const beforeRole = await passwordLogin(email, resetPassword)
  check('вход с временным паролем после сброса', await alive(beforeRole))
  const roleChange = await call<{ role: string }>('PATCH', `/api/users/${userId}`, { role: 'ANALYST' })
  const beforeRoleAfter = await me(beforeRole)
  check(
    'смена роли: выданная сессия — 401',
    roleChange.status === 200 && roleChange.body.data?.role === 'ANALYST' && beforeRoleAfter.status === 401,
    `${roleChange.status}, ${beforeRoleAfter.status}`,
  )
  const afterRole = await passwordLogin(email, resetPassword)
  const afterRoleMe = await me(afterRole)
  check('новый вход после смены роли — уже с новой ролью', afterRoleMe.body.data?.role === 'ANALYST', afterRoleMe.body.data?.role ?? `статус ${afterRoleMe.status}`)

  // 4. Блокировка: сессия и подписка на календарь.
  actAs(userId)
  const issued = await call<{ url: string }>('POST', '/api/me/calendar')
  const feedPath = issued.body.data?.url ? new URL(issued.body.data.url).pathname : '/api/calendar/нет.ics'
  const feedBefore = await fetch(`${BASE_URL}${feedPath}`)
  check('до блокировки: подписка выпущена, лента — 200', issued.status === 201 && feedBefore.status === 200, `${issued.status}, ${feedBefore.status}`)

  actAs(adminId)
  const block = await call('PATCH', `/api/users/${userId}`, { isActive: false })
  const afterBlockMe = await me(afterRole)
  check('блокировка: выданная сессия — 401', block.status === 200 && afterBlockMe.status === 401, `${block.status}, ${afterBlockMe.status}`)
  const feedBlocked = await fetch(`${BASE_URL}${feedPath}`)
  check('лента заблокированного — 404', feedBlocked.status === 404, `статус ${feedBlocked.status}`)
  const journal = await call<Array<{ action: string; user: { id: string } | null; payload: { reason?: string } | null }>>(
    'GET',
    `/api/audit?objectType=User&objectId=${userId}&pageSize=50`,
  )
  const revokeEntry = (journal.body.data ?? []).find((entry) => entry.action === 'calendar.revoke')
  check(
    'в журнале — отзыв подписки при блокировке, от имени администратора',
    revokeEntry?.payload?.reason === 'user.block' && revokeEntry.user?.id === adminId,
    JSON.stringify(revokeEntry?.payload ?? null),
  )

  // Разблокировка: запись подписки удалена (ссылка не оживает), старая сессия тоже.
  const unblock = await call('PATCH', `/api/users/${userId}`, { isActive: true })
  const feedUnblocked = await fetch(`${BASE_URL}${feedPath}`)
  actAs(userId)
  const feedStatus = await call<{ active: boolean }>('GET', '/api/me/calendar')
  check(
    'после разблокировки подписки нет: ссылка — 404, статус active=false',
    unblock.status === 200 && feedUnblocked.status === 404 && feedStatus.body.data?.active === false,
    `${unblock.status}, ${feedUnblocked.status}, ${JSON.stringify(feedStatus.body.data)}`,
  )
  check('после разблокировки сессия, выданная до блокировки, не оживает', (await me(afterRole)).status === 401)
  check('новый вход после разблокировки работает', await alive(await passwordLogin(email, resetPassword)))

  // Итог в журнале: всё, что отзывало сессии, записано.
  actAs(adminId)
  const actions = new Set(
    (
      await call<Array<{ action: string }>>('GET', `/api/audit?objectType=User&objectId=${userId}&pageSize=50`)
    ).body.data?.map((entry) => entry.action) ?? [],
  )
  check(
    'журнал: смена пароля, сброс, смена роли, блокировка',
    ['user.password.change', 'user.password.reset', 'user.role.change', 'user.block'].every((action) => actions.has(action)),
    [...actions].join(', '),
  )
  actAs(null)
}

async function checkTelegram(ctx: ProbeContext): Promise<void> {
  step('Уведомления в Telegram: вебхук без секрета закрыт, кабинет честно говорит о настройке')
  const { rep, managerId } = ctx

  {
    /*
     * Настоящий бот пробнику не нужен и не используется (решение 102). Вебхук без
     * заголовка секрета или с чужим — 403 при любой настройке: без TELEGRAM_WEBHOOK_SECRET
     * он закрыт для всех. Запрос Telegram идёт без Origin — как этот.
     */
    const update = JSON.stringify({ update_id: 1, message: { chat: { id: 42, type: 'private' }, text: '/today' } })
    const webhook = async (headers: Record<string, string>) => {
      const response = await fetch(`${BASE_URL}/api/telegram/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: update,
      })
      const body = (await response.json().catch(() => ({}))) as { error?: { code?: string } }
      return { status: response.status, code: body.error?.code ?? null }
    }
    const noSecret = await webhook({})
    const wrongSecret = await webhook({ 'x-telegram-bot-api-secret-token': `probe-${Date.now()}` })
    check(
      'вебхук без секрета и с чужим секретом — 403 по контракту',
      noSecret.status === 403 && noSecret.code === 'FORBIDDEN' && wrongSecret.status === 403,
      `без секрета ${noSecret.status}, с чужим ${wrongSecret.status}`,
    )

    actAs(managerId)
    type Status = { configured: boolean; available: boolean; linked: boolean; username: string | null }
    const status = await call<Status>('GET', '/api/me/telegram')
    const data = status.body.data
    check(
      'менеджеру: состояние блока с признаком настройки, сводка доступна',
      status.status === 200 && typeof data?.configured === 'boolean' && data.available === true,
      `статус ${status.status}, ${JSON.stringify(data)}`,
    )
    const connect = await call<{ url: string; expiresAt: string }>('POST', '/api/me/telegram')
    if (data?.configured) {
      const token = /[?&]start=([^&]+)$/.exec(connect.body.data?.url ?? '')?.[1] ?? ''
      check(
        'бот настроен: ссылка на t.me с токеном не длиннее 64 символов из алфавита Telegram',
        connect.status === 200 && /^https:\/\/t\.me\//.test(connect.body.data?.url ?? '') && /^[A-Za-z0-9_-]{1,64}$/.test(token),
        `статус ${connect.status}`,
      )
    } else {
      check(
        'бот не настроен: ссылки нет — 502 «не настроены администратором»',
        connect.status === 502 && connect.body.error?.code === 'INTEGRATION_ERROR',
        `статус ${connect.status}`,
      )
    }
    // Отключение без привязки — не ошибка. Настоящую привязку пробник не трогает.
    if (data && !data.linked) {
      const off = await call<Status>('DELETE', '/api/me/telegram')
      check('отключение без привязки — 200, linked=false', off.status === 200 && off.body.data?.linked === false, `статус ${off.status}`)
    }

    if (rep) {
      actAs(rep.id)
      const repStatus = await call<Status>('GET', '/api/me/telegram')
      const repConnect = await call('POST', '/api/me/telegram')
      check(
        'представителю вуза сводка недоступна: available=false, ссылка — 403',
        repStatus.status === 200 && repStatus.body.data?.available === false && repConnect.status === 403,
        `состояние ${repStatus.status}, ссылка ${repConnect.status}`,
      )
    }
    actAs(null)
  }
}

async function checkStaleSession(): Promise<void> {
  step('Устаревшая сессия не запирает вход')

  /*
   * Cookie сессии остался, а пользователя за ним нет — так бывает после
   * перезаливки демо-данных. Приложение получает 401 и ведёт на вход
   * с `reauth=1`; middleware обязан эту страницу пропустить, иначе вход
   * и главная перенаправляют друг на друга, и экран остаётся пустым.
   */
  const stale = { cookie: 'authjs.session-token=stale-session-from-yesterday' }
  const withReauth = await fetch(`${BASE_URL}/login?${REAUTH_PARAM}=1`, { headers: stale, redirect: 'manual' })
  check('со старым cookie вход с reauth открывается', withReauth.status === 200, `код ${withReauth.status}`)

  // Обычный заход на вход с живой сессией по-прежнему ведёт на главную.
  const plain = await fetch(`${BASE_URL}/login`, { headers: stale, redirect: 'manual' })
  check('без reauth вошедший уходит со входа на главную', plain.status === 307, `код ${plain.status}`)
}

async function checkLoginAttempts(): Promise<void> {
  step('Исчерпанные попытки входа отличимы от неверного пароля; перед блокировкой — «не робот»')

  // Несуществующий адрес: так проверка не закрывает вход демо-учётной записи
  // и заодно доказывает, что код не выдаёт существование адреса.
  const email = `probe-${Date.now()}@example.invalid`
  const attempt = async (captcha?: string): Promise<string | null> => {
    // Своя пара запросов без общего состояния пробника: cookie csrf-токена
    // нужна только этой попытке.
    const csrf = await fetch(`${BASE_URL}/api/auth/csrf`)
    const cookie = (csrf.headers.getSetCookie?.() ?? [])
      .map((line) => line.split(';')[0])
      .join('; ')
    const { csrfToken } = (await csrf.json()) as { csrfToken: string }
    const form = new URLSearchParams({ csrfToken, email, password: 'заведомо-неверный' })
    if (captcha !== undefined) form.set('captcha', captcha)
    const response = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: form.toString(),
    })
    const location = response.headers.get('location') ?? ''
    return /[?&]code=([a-z_]+)/.exec(location)?.[1] ?? null
  }
  // Задача решается так же, как в браузере (captcha-search.ts), только здесь.
  interface Challenge { algorithm: string; challenge: string; salt: string; maxNumber: number; signature: string }
  const challengeResponse = async () => fetch(`${BASE_URL}/api/login-challenge`)
  const solved = async (): Promise<string> => {
    const { data } = (await (await challengeResponse()).json()) as { data: Challenge }
    let number = 0
    while (number <= data.maxNumber && createHash('sha256').update(data.salt + number).digest('hex') !== data.challenge) {
      number += 1
    }
    const { algorithm, challenge, salt, signature } = data
    return JSON.stringify({ algorithm, challenge, salt, number, signature })
  }

  const challenge = await challengeResponse()
  check(
    'задача «не робот» выдаётся без входа и не кэшируется',
    challenge.status === 200 && (challenge.headers.get('cache-control') ?? '').includes('no-store'),
    `статус ${challenge.status}, cache-control ${challenge.headers.get('cache-control')}`,
  )

  const codes: Array<string | null> = []
  for (let index = 0; index < 3; index += 1) codes.push(await attempt())
  const withoutCaptcha = await attempt()
  const reused = await solved()
  const firstSolved = await attempt(reused)
  const replayed = await attempt(reused)
  const forged = JSON.stringify({ ...JSON.parse(await solved()), number: -1 })
  const forgedCode = await attempt(forged)
  const secondSolved = await attempt(await solved())
  const blocked = await attempt()

  check(
    'три неудачи — «неверные данные», дальше без решённой задачи — «нужна проверка»',
    codes.every((code) => code === 'credentials') && withoutCaptcha === 'captcha_required',
    [...codes, withoutCaptcha].join(', '),
  )
  check(
    'с решённой задачей пароль проверяется; повтор того же решения и подделка — снова «нужна проверка»',
    firstSolved === 'credentials' && replayed === 'captcha_required' && forgedCode === 'captcha_required',
    [firstSolved, replayed, forgedCode].join(', '),
  )
  check(
    'пятая неудача закрывает вход, дальше — «слишком много попыток» без всякой задачи',
    secondSolved === 'credentials' && blocked === 'too_many_attempts',
    [secondSolved, blocked].join(', '),
  )
}

async function checkCalendarFeed(ctx: ProbeContext): Promise<void> {
  step('Календарь: ссылка — единственный доступ, отзыв закрывает её сразу')
  const { rep, adminId, cooperations, managerId } = ctx

  if (!adminId || !managerId || !rep) {
    check('демо-данные готовы (администратор, менеджер, представитель вуза)', false, 'запустите npm run db:seed')
  } else {
    /** Лента без cookie — как её запрашивает календарное приложение. */
    const feed = async (url: string) => {
      // Адрес в ответе строится от AUTH_URL / APP_BASE_URL; пробник ходит на свой сервер.
      const path = url.startsWith('http') ? new URL(url).pathname : url
      const response = await fetch(`${BASE_URL}${path}`)
      return {
        status: response.status,
        type: response.headers.get('content-type') ?? '',
        cache: response.headers.get('cache-control') ?? '',
        text: await response.text(),
      }
    }
    const randomToken = () =>
      Buffer.from(Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))).toString('base64url')

    const misses = await Promise.all(
      ['/api/calendar/.ics', '/api/calendar/abc.ics', `/api/calendar/${randomToken()}.ics`, `/api/calendar/${randomToken()}`].map(feed),
    )
    check(
      'без токена, кривой и чужой (неизвестный) токен — 404 без различий',
      misses.every((miss) => miss.status === 404) && new Set(misses.slice(1).map((miss) => miss.text)).size === 1,
      misses.map((miss) => miss.status).join(', '),
    )

    actAs(rep.id)
    const repStatus = await call('GET', '/api/me/calendar')
    const repIssue = await call('POST', '/api/me/calendar')
    check('представителю вуза подписка закрыта — 403', repStatus.status === 403 && repIssue.status === 403, `${repStatus.status}, ${repIssue.status}`)

    actAs(managerId)
    const first = await call<{ url: string; webcalUrl: string; replaced: boolean }>('POST', '/api/me/calendar')
    const firstUrl = first.body.data?.url ?? ''
    check('менеджер выпускает ссылку — 201, адрес вида …/api/calendar/<43 знака>.ics', first.status === 201 && /\/api\/calendar\/[A-Za-z0-9_-]{43}\.ics$/.test(firstUrl), `статус ${first.status}`)
    const status = await call<{ active: boolean }>('GET', '/api/me/calendar')
    const token = firstUrl.split('/').pop()?.replace('.ics', '') ?? '—'
    check('статус подписки — без адреса ссылки', status.body.data?.active === true && !status.raw.includes(token))

    const ok = await feed(firstUrl)
    check('лента — 200, text/calendar и no-store', ok.status === 200 && ok.type.startsWith('text/calendar') && ok.cache.includes('no-store'), `${ok.status}, ${ok.type}, ${ok.cache}`)
    check('лента — iCalendar с CRLF и строками не длиннее 75 октетов', ok.text.startsWith('BEGIN:VCALENDAR\r\n') && ok.text.endsWith('END:VCALENDAR\r\n') && ok.text.split('\r\n').every((line) => !line.includes('\n') && Buffer.byteLength(line) <= 75))
    const unfolded = ok.text.replace(/\r\n[ \t]/g, '')
    check('в ленте есть сроки этапов менеджера', /SUMMARY:(\[[^\]]+\] )?Срок: этап \d+ «/.test(unfolded))

    // Почт и ФИО в ленте нет: ни контактов вузов, ни сотрудников.
    const me = await call<{ fullName: string }>('GET', '/api/me')
    const coopUniversities = [...new Set((cooperations.body.data ?? []).filter((item) => item.responsible.id === managerId).map((item) => item.universityId))]
    const contactNames: string[] = []
    for (const universityId of coopUniversities.slice(0, 5)) {
      const card = await call<{ contacts: Array<{ fullName: string }> }>('GET', `/api/universities/${universityId}`)
      contactNames.push(...(card.body.data?.contacts ?? []).map((contact) => contact.fullName))
    }
    check('в ленте нет почт', !/[\w.+-]+@[\w-]+\.[\w.-]+/.test(unfolded))
    check(
      'в ленте нет ФИО контактов вузов и сотрудника',
      contactNames.length > 0 && contactNames.every((name) => !unfolded.includes(name)) && !unfolded.includes(me.body.data?.fullName ?? '—'),
      `контактов проверено: ${contactNames.length}`,
    )

    const second = await call<{ url: string; replaced: boolean }>('POST', '/api/me/calendar')
    const secondUrl = second.body.data?.url ?? ''
    const afterReissueOld = await feed(firstUrl)
    const afterReissueNew = await feed(secondUrl)
    check('перевыпуск: старая ссылка — 404, новая — 200', second.body.data?.replaced === true && afterReissueOld.status === 404 && afterReissueNew.status === 200, `${afterReissueOld.status}, ${afterReissueNew.status}`)

    const revoked = await call<{ revoked: boolean }>('DELETE', '/api/me/calendar')
    const afterRevoke = await feed(secondUrl)
    const revokedAgain = await call<{ revoked: boolean }>('DELETE', '/api/me/calendar')
    check('после отзыва старый адрес — 404, повторный отзыв — revoked=false', revoked.body.data?.revoked === true && afterRevoke.status === 404 && revokedAgain.body.data?.revoked === false, `${afterRevoke.status}`)

    actAs(adminId)
    const journal = await call<Array<{ action: string }>>('GET', `/api/audit?objectType=User&objectId=${managerId}&pageSize=20`)
    const actions = (journal.body.data ?? []).map((entry) => entry.action)
    check('в журнале выпуск и отзыв, токена нет', actions.includes('calendar.issue') && actions.includes('calendar.revoke') && !journal.raw.includes(token) && !journal.raw.includes(secondUrl.split('/').pop() ?? '—'))

    // Заблокированный пользователь: его лента — 404, как неизвестная.
    const blockedEmail = `probe-calendar-${Date.now()}@example.invalid`
    const createdUser = await call<{ user: { id: string } }>('POST', '/api/users', { email: blockedEmail, fullName: 'Пробный Календарь Пробникович', role: 'VIEWER' })
    const blockedId = createdUser.body.data?.user.id
    if (!blockedId) {
      check('пробный пользователь для блокировки заведён', false, `статус ${createdUser.status}`)
    } else {
      actAs(blockedId)
      const viewerFeed = await call<{ url: string }>('POST', '/api/me/calendar')
      const viewerUrl = viewerFeed.body.data?.url ?? ''
      const beforeBlock = await feed(viewerUrl)
      actAs(adminId)
      const block = await call('PATCH', `/api/users/${blockedId}`, { isActive: false })
      const afterBlock = await feed(viewerUrl)
      check(
        'наблюдатель выпускает ссылку; после блокировки его лента — 404',
        viewerFeed.status === 201 && beforeBlock.status === 200 && block.status === 200 && afterBlock.status === 404,
        `${viewerFeed.status}, ${beforeBlock.status}, ${block.status}, ${afterBlock.status}`,
      )
    }
  }
}

/** Итог прогона: число проверок и список провалившихся. */
/**
 * «Всё о субъекте» по 152-ФЗ (решение 116): права, состав выгрузки, отсутствие секретов,
 * реестр запросов со сроком, самостоятельная выгрузка с ограничением частоты и
 * обезличивание по запросу. Субъекты — свои, заведённые пробником: демо-данные не трогаются.
 */
async function checkDsar(ctx: ProbeContext): Promise<void> {
  step('Права субъекта ПД: выгрузка «всё о субъекте», реестр запросов, обезличивание (решение 116)')
  const { rep, adminId, managerId } = ctx
  if (!adminId || !managerId || !rep) {
    check('демо-данные готовы (администратор, менеджер, представитель вуза)', false, 'запустите npm run db:seed')
    return
  }

  /** Пути ко всем ключам, похожим на секрет, — рекурсивно. */
  const secretKeys = (value: unknown, path = ''): string[] => {
    if (Array.isArray(value)) return value.flatMap((item, index) => secretKeys(item, `${path}[${index}]`))
    if (value === null || typeof value !== 'object') return []
    return Object.entries(value).flatMap(([key, nested]) => [
      ...(/password|secret|token|hash/i.test(key) ? [`${path}.${key}`] : []),
      ...secretKeys(nested, `${path}.${key}`),
    ])
  }
  const REQUIRED_KEYS = [
    'subject', 'generatedAt', 'operator', 'purposes', 'legalBasis', 'categories', 'sources',
    'recipients', 'retention', 'data', 'auditTrail', 'counts',
  ]

  // Свои субъекты: пользователь-наблюдатель и контакт в своём пробном вузе.
  actAs(adminId)
  const sfx = Date.now().toString().slice(-6)
  const email = `probe-dsar-${sfx}@example.invalid`
  const createdUser = await call<{ user: { id: string } }>('POST', '/api/users', {
    email,
    fullName: `Пробный Субъект ${sfx}`,
    role: 'VIEWER',
  })
  const subjectId = createdUser.body.data?.user.id
  const contactName = `Пробный Контакт Субъекта ${sfx}`
  const createdUniversity = await call<{ id: string; contacts: Array<{ id: string }> }>('POST', '/api/universities', {
    name: `Пробный вуз прав субъекта ${sfx}`,
    city: 'Тверь',
    region: 'Тверская область',
    contacts: [{ fullName: contactName, position: 'Методист', email: `probe-dsar-contact-${sfx}@example.invalid`, isPrimary: true }],
  })
  const contactId = createdUniversity.body.data?.contacts[0]?.id
  check('заведены пробный пользователь и контакт', Boolean(subjectId && contactId))
  if (!subjectId || !contactId) {
    actAs(null)
    return
  }

  // Права: всё администраторское — только ADMIN.
  const adminOnly: Array<[string, string, unknown]> = [
    ['GET', `/api/admin/dsar/users/${subjectId}/export`, undefined],
    ['GET', `/api/admin/dsar/contacts/${contactId}/export`, undefined],
    ['POST', `/api/admin/dsar/users/${subjectId}/erase`, { confirm: email }],
    ['POST', `/api/admin/dsar/contacts/${contactId}/erase`, { confirm: contactName }],
    ['GET', '/api/admin/dsar/requests', undefined],
    ['POST', '/api/admin/dsar/requests', { subjectType: 'USER', subjectId, kind: 'EXPORT' }],
  ]
  for (const [label, actor] of [['менеджеру', managerId], ['представителю вуза', rep.id]] as const) {
    actAs(actor)
    for (const [method, path, body] of adminOnly) {
      const result = await call(method, path, body)
      check(`${label}: ${method} ${path.replace(subjectId, ':id').replace(contactId, ':id')} — 403`, result.status === 403, `статус ${result.status}`)
    }
  }

  // Запрос по письму: срок — 10 рабочих дней, повтор — 409.
  actAs(adminId)
  type Request = { id: string; status: string; dueAt: string; requestedAt: string; overdue: boolean }
  const registered = await call<Request>('POST', '/api/admin/dsar/requests', { subjectType: 'USER', subjectId, kind: 'EXPORT' })
  const dueDays = registered.body.data
    ? (Date.parse(registered.body.data.dueAt) - Date.parse(registered.body.data.requestedAt)) / 86_400_000
    : 0
  check(
    'запрос по письму зарегистрирован, срок 10 рабочих дней (14–25 календарных)',
    registered.status === 201 && registered.body.data?.status === 'OPEN' && dueDays >= 13 && dueDays <= 26,
    `статус ${registered.status}, дней до срока ${dueDays.toFixed(1)}`,
  )
  const duplicate = await call('POST', '/api/admin/dsar/requests', { subjectType: 'USER', subjectId, kind: 'EXPORT' })
  check('второй открытый запрос того же вида — 409', duplicate.status === 409, `статус ${duplicate.status}`)
  const unknownSubject = await call('POST', '/api/admin/dsar/requests', { subjectType: 'CONTACT', subjectId: 'нет-такого', kind: 'ERASE' })
  check('запрос о несуществующем субъекте — 422', unknownSubject.status === 422, `статус ${unknownSubject.status}`)

  // Выгрузка администратором: заголовки, ключи, нет секретов, закрывает запрос.
  const response = await fetch(`${BASE_URL}/api/admin/dsar/users/${subjectId}/export`, {
    headers: { cookie: `skilllink_user=${adminId}` },
  })
  const raw = await response.text()
  let exported: Record<string, unknown> = {}
  try {
    exported = (JSON.parse(raw) as { data: Record<string, unknown> }).data ?? {}
  } catch {
    exported = {}
  }
  check(
    'выгрузка пользователя: 200, вложение, no-store',
    response.status === 200 &&
      (response.headers.get('content-disposition') ?? '').startsWith('attachment') &&
      (response.headers.get('cache-control') ?? '').includes('no-store'),
    `статус ${response.status}`,
  )
  const missingKeys = REQUIRED_KEYS.filter((key) => !(key in exported))
  check('в выгрузке все сведения ч. 7 ст. 14 и данные', missingKeys.length === 0, missingKeys.join(', '))
  const trail = exported.auditTrail as { byActor?: unknown; aboutSubject?: { total?: number } } | undefined
  check('журнал: действия субъекта и действия над ним', Boolean(trail?.byActor) && (trail?.aboutSubject?.total ?? 0) >= 1)
  const leaked = secretKeys(exported)
  check('в выгрузке нет ключей password/secret/token/hash', leaked.length === 0, leaked.slice(0, 3).join(', '))
  check('выгрузка содержит почту субъекта (это его данные)', raw.includes(email))
  const closed = await call<Request[]>('GET', `/api/admin/dsar/requests?subjectType=USER&subjectId=${subjectId}`)
  check(
    'выгрузка закрыла запрос по письму',
    (closed.body.data ?? []).some((item) => item.id === registered.body.data?.id && item.status === 'COMPLETED'),
  )
  const unknownExport = await call('GET', '/api/admin/dsar/users/нет-такого/export')
  check('выгрузка несуществующего — 404', unknownExport.status === 404, `статус ${unknownExport.status}`)

  const contactExport = await call<Record<string, unknown>>('GET', `/api/admin/dsar/contacts/${contactId}/export`)
  const contactMissing = REQUIRED_KEYS.filter((key) => !(key in (contactExport.body.data ?? {})))
  check(
    'выгрузка контакта: все ключи, без секретов',
    contactExport.status === 200 && contactMissing.length === 0 && secretKeys(contactExport.body.data).length === 0,
    contactMissing.join(', '),
  )

  // Сам субъект: «Мои данные», второй раз подряд — 409.
  actAs(subjectId)
  const own = await call<{ subject: { id: string } }>('GET', '/api/me/data-export')
  check('пользователь выгружает свои данные сам', own.status === 200 && own.body.data?.subject.id === subjectId, `статус ${own.status}`)
  const again = await call('GET', '/api/me/data-export')
  check('повтор раньше 10 минут — 409', again.status === 409, `статус ${again.status}`)

  // Журнал: события DSAR без ПД.
  actAs(adminId)
  const journal = await call<Array<{ action: string }>>('GET', `/api/audit?objectType=User&objectId=${subjectId}&pageSize=50`)
  const actions = new Set((journal.body.data ?? []).map((entry) => entry.action))
  check(
    'журнал: dsar.requested и dsar.exported без почты субъекта',
    actions.has('dsar.requested') && actions.has('dsar.exported') && !journal.raw.includes(email),
  )

  // Обезличивание: защита и результат.
  const self = await call('POST', `/api/admin/dsar/users/${adminId}/erase`, { confirm: 'admin@skilllink.demo' })
  check('обезличить себя — 409', self.status === 409, `статус ${self.status}`)
  const shared = await call('POST', `/api/admin/dsar/users/${managerId}/erase`, { confirm: 'manager@skilllink.demo' })
  check('обезличить общую демо-учётку — 409', shared.status === 409, `статус ${shared.status}`)
  const wrong = await call('POST', `/api/admin/dsar/users/${subjectId}/erase`, { confirm: 'чужой@example.invalid' })
  check('неверное подтверждение — 422', wrong.status === 422, `статус ${wrong.status}`)
  const erased = await call<{ alreadyErased: boolean; sections: Record<string, { rows: number }> }>(
    'POST',
    `/api/admin/dsar/users/${subjectId}/erase`,
    { confirm: email.toUpperCase() },
  )
  check('обезличивание пользователя — 200', erased.status === 200 && erased.body.data?.alreadyErased === false, `статус ${erased.status}`)
  const card = await call<{ fullName: string; email: string; isActive: boolean }>('GET', `/api/users/${subjectId}`)
  check(
    'после обезличивания: заглушка вместо ФИО и почты, учётная запись заблокирована',
    card.body.data?.fullName === 'Пользователь удалён' && card.body.data.isActive === false && !card.raw.includes(email),
  )
  const repeat = await call<{ alreadyErased: boolean }>('POST', `/api/admin/dsar/users/${subjectId}/erase`, { confirm: 'x' })
  check('повтор обезличивания — 200 alreadyErased', repeat.status === 200 && repeat.body.data?.alreadyErased === true)
  const afterExport = await call<{ subject: { erased: boolean } }>('GET', `/api/admin/dsar/users/${subjectId}/export`)
  check(
    'выгрузка после обезличивания: признак erased, прежней почты нет',
    afterExport.body.data?.subject.erased === true && !afterExport.raw.includes(email),
  )

  const contactErase = await call<{ alreadyErased: boolean }>('POST', `/api/admin/dsar/contacts/${contactId}/erase`, {
    confirm: contactName.toLowerCase(),
  })
  const universityCard = await call<{ contacts: Array<{ id: string; fullName: string; isAnonymized: boolean }> }>(
    'GET',
    `/api/universities/${createdUniversity.body.data?.id}`,
  )
  check(
    'обезличивание контакта по запросу — тот же результат, что в карточке вуза',
    contactErase.status === 200 &&
      universityCard.body.data?.contacts.find((item) => item.id === contactId)?.isAnonymized === true,
    `статус ${contactErase.status}`,
  )
  const overdue = await call<Request[]>('GET', '/api/admin/dsar/requests?overdue=true')
  check('реестр: фильтр просроченных отвечает', overdue.status === 200 && Array.isArray(overdue.body.data))
  actAs(null)
}

function printSummary(): void {
  console.log(`\n${BOLD}Итог${RESET}`)
  console.log(`  ${GREEN}Пройдено: ${passed}${RESET}`)
  if (failed > 0) {
    console.log(`  ${RED}Найдено проблем: ${failed}${RESET}`)
    for (const name of failures) console.log(`    ${RED}- ${name}${RESET}`)
    process.exitCode = 1
  } else {
    console.log(`  ${GREEN}Проблем не найдено.${RESET}`)
  }
}

async function main(): Promise<void> {
  console.log(`${BOLD}Пробник SkillLink${RESET}`)
  console.log(`${GREY}Сервер: ${BASE_URL}${RESET}`)

  await warmUp()

  const health = await call('GET', '/api/health')
  if (health.status !== 200) {
    console.log(`\n${RED}Сервер не отвечает. Запустите npm run dev.${RESET}`)
    process.exitCode = 1
    return
  }

  const ctx = await prepare()

  await checkRepIsolation(ctx)
  await checkNoContradictoryStates(ctx)
  await checkClosedCooperationFrozen(ctx)
  await checkPortalMaterialConfirmation(ctx)
  await checkUniversityItemMarking(ctx)
  await checkMalformedInput()
  await checkDoubleClick(ctx)
  await checkErrorContract()
  await checkAuditAdminOnly(ctx)
  await checkConcurrentStageChanges(ctx)
  await checkStageKeepsResultAndReason(ctx)
  await checkRecommendationReopens(ctx)
  await checkOverdueRecommendationTransitions(ctx)
  await checkCrossUniversityLinks(ctx)
  await checkDocumentDoubleSubmit(ctx)
  await checkArchivedUniversityNotRated()
  await checkProductCrud(ctx)
  await checkProgramImport()
  await checkRepDocumentHistory(ctx)
  await checkUniversityRatingPrivacy(ctx)
  await checkControlPoints(ctx)
  await checkCountersNotTruncated()
  await checkUnknownRoute()
  await checkSecurityHeaders()
  await checkRatingMethodsAgree()
  await checkNoContradictionsInDb()
  await checkStageNotCountedTwice()
  await checkHealth()
  await checkClosedCooperationQuiet()
  await checkRussianSorting(ctx)
  await checkProgramCardMatchesAnalytics(ctx)
  await checkSearchAndNotifications(ctx)
  await checkCooperationSearch(ctx)
  await checkProblemCounter(ctx)
  await checkCooperationCount(ctx)
  await checkRecommendationFeedOrder(ctx)
  await checkCalculationParameters(ctx)
  await checkSkillDirectory(ctx)
  await checkSkillNameConsistency(ctx)
  await checkContactPrivacy(ctx)
  await checkContactLegalBasis(ctx)
  await checkUserManagement(ctx)
  await checkSessionRevocation(ctx)
  await checkTelegram(ctx)
  await checkStaleSession()
  await checkLoginAttempts()
  await checkCalendarFeed(ctx)
  await checkDsar(ctx)

  printSummary()
}

main().catch((error) => {
  console.error(`${RED}Пробник упал:${RESET}`, error)
  process.exitCode = 1
})
