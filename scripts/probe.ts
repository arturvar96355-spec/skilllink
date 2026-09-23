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
import { RECOMMENDATION_SORT_MOST_IMPORTANT } from '../src/shared/contracts/recommendation'
import { REAUTH_PARAM } from '../src/shared/auth/reauth'

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
  body: { data?: T; meta?: Record<string, unknown>; error?: { code: string; message: string } }
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
 * А человек, запустивший npm run dev и сразу npm run smoke, упирался бы
 * в непонятный отказ.
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
    '/api/skills/gaps',
    '/api/skills/demand',
    '/api/products?pageSize=1',
    '/api/workflow/overdue',
    '/api/workflow/blocked',
    '/api/audit?pageSize=1',
    '/api/data-sources',
    '/api/integrations/status',
    '/api/document-templates',
    '/api/export?dataset=universities&limit=1',
    '/api/portal/overview',
    '/api/openapi.json',
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

  // ── Подготовка ─────────────────────────────────────────────────────────────
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
  const managerId = anyCooperation?.responsible.id ?? null

  // ── 1. Изоляция представителя вуза ─────────────────────────────────────────
  step('1. Представитель вуза не должен видеть и трогать чужое')

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

  // ── 2. Целостность состояний ───────────────────────────────────────────────
  step('2. Система не должна оставлять противоречивые состояния')

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

  // ── 2а. Закрытая связка ────────────────────────────────────────────────────
  step('2а. У закрытой связки процесс заморожен')

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

  // ── 3. Кривой ввод ─────────────────────────────────────────────────────────
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

  // ── 3а. Одновременные запросы ──────────────────────────────────────────────
  step('3а. Двойной клик не должен ломать данные')

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

  // ── 4. Формат ошибок ───────────────────────────────────────────────────────
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

  // ── 5. Журнал и права ──────────────────────────────────────────────────────
  step('5. Журнал действий закрыт от всех, кроме администратора')

  const auditAsManager = await call('GET', '/api/audit')
  check('менеджеру журнал закрыт', auditAsManager.status === 403, `статус ${auditAsManager.status}`)

  if (adminId) {
    actAs(adminId)
    const auditAsAdmin = await call<unknown[]>('GET', '/api/audit?pageSize=5')
    check('администратору журнал открыт', auditAsAdmin.status === 200)
    actAs(null)
  }

  // ── Этапы одной связки меняются по очереди ────────────────────────────────
  step('Одновременные изменения этапов одной связки не ломают этап 14')

  if (managerId) {
    const sfx = Date.now().toString().slice(-6)
    const uni = await call<{ id: string }>('POST', '/api/universities', {
      name: `Пробный вуз очереди ${sfx}`,
      city: 'Тверь',
      region: 'Тверская область',
    })
    const program = await call<{ id: string }>('POST', '/api/programs', {
      universityId: uni.body.data?.id,
      name: `Пробная программа очереди ${sfx}`,
      level: 'BACHELOR',
    })

    // Этапы 1–13 закрываются одновременно — как если бы их закрывали несколько
    // человек разом. Без очереди каждая транзакция видела чужие этапы ещё
    // открытыми, и этап 14 оставался «в работе» при закрытых 1–13.
    const finals: string[] = []
    for (let round = 0; round < 3; round += 1) {
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

  // ── Итог этапа после записи ────────────────────────────────────────────────
  step('Завершённый этап не теряет результат, заблокированный — причину')

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
    } else {
      check('связка для проверки итога создана', false)
    }
  }

  // ── Вернувшаяся проблема — снова открытая рекомендация ─────────────────────
  step('Рекомендация, закрытая системой, открывается, когда проблема вернулась')

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

  // ── Привязки записи ведут в один вуз ───────────────────────────────────────
  step('Встреча и документ не связывают разные вузы, счётчики представителю — свои')

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

    // Раньше каждая привязка проверялась сама по себе, и такая встреча показывала
    // представителю вуза чужую программу и ФИО чужого контакта.
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

  // ── История документа: внутренние комментарии — только сотрудникам ────────
  step('Представитель не видит внутренних комментариев в истории документа')

  if (rep) {
    // Причина отклонения — заметка сотрудников друг другу (решение 9). В истории
    // этапов и в ленте событий она представителю не отдавалась, а в истории
    // документа — отдавалась.
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

  // ── Рейтинг вуза: не должен становиться каналом утечки ─────────────────────
  step('Рейтинг вуза не раскрывает чужие данные')

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

  // ── Контрольные точки: порядок этапов гибридный, но не фиктивный ───────────
  step('Контрольные точки нельзя обойти')

  {
    // Нужна связка, у которой этапы до шестого ещё не закрыты.
    const list = await call<Array<{ id: string; currentStage: { stageNumber: number } | null }>>(
      'GET',
      '/api/cooperations?pageSize=50',
    )
    const early = (list.body.data ?? []).find(
      (row) => (row.currentStage?.stageNumber ?? 99) <= 4,
    )

    if (!early) {
      check('есть связка в начале конвейера', false, 'нужен npm run db:seed')
    } else {
      const card = await call<{
        stages: Array<{ id: string; stageNumber: number; status: string }>
      }>('GET', `/api/cooperations/${early.id}`)
      const stages = card.body.data?.stages ?? []
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

        // Возвращаем как было, чтобы пробник не оставлял следов.
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

  // ── Сводки не выдают обрезанную выборку за полную ──────────────────────────
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

  // ── Опечатка в адресе не ломает разбор ответа ──────────────────────────────
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

  // ── Защитные заголовки ─────────────────────────────────────────────────────
  step('Ответы несут защитные заголовки')

  {
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
    }
  }

  // ── Быстрый расчёт рейтинга не расходится с полным ─────────────────────────
  step('Два способа расчёта рейтинга дают один результат')

  {
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

  // ── Целостность данных ─────────────────────────────────────────────────────
  step('В базе нет противоречивых состояний')

  {
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

  // ── Просрочка и предупреждение не пересекаются ─────────────────────────────
  step('Этап не считается проблемным дважды')

  {
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

  // ── Проверка живости говорит правду ────────────────────────────────────────
  step('Здоровье приложения отвечает по делу')

  {
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

  // ── Закрытая связка не создаёт проблем ─────────────────────────────────────
  step('Закрытая связка не требует внимания')

  {
    // Этапы закрытой связки заморожены: изменить их нельзя. Показывать их как
    // просроченные значит просить сделать то, что система же и запрещает —
    // и заполнять дашборд тем, на что никто не может повлиять.
    type CoopRow = { id: string; status: string }
    type StageRow = { cooperation?: { id?: string }; cooperationId?: string }

    // Закрытые — отбором по статусу, а не с первой страницы реестра: на рабочей
    // базе новые связки вытесняли закрытые за первую сотню, и проверка падала
    // без ошибки в приложении.
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

  // ── Списки идут в русском алфавитном порядке ───────────────────────────────
  step('Списки отсортированы по-русски')

  {
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

  // ── Карточка программы и личный кабинет ───────────────────────────────────
  step('Карточка программы и личный кабинет не расходятся с аналитикой')

  {
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

  // ── Поиск и уведомления ────────────────────────────────────────────────────
  step('Поиск и уведомления не раскрывают чужого и не врут')

  {
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

    // Знаки LIKE в запросе — обычные символы, а не «что угодно»: поиск «_»
    // находил все вузы базы. От имени администратора: представитель вуза
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
      items: Array<{ kind: string; target: { type: string; id: string } }>
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
      check(
        'просроченных в ленте столько же, сколько в личной статистике',
        feed.status === 200 && overdue === stats.body.data?.overdueStages,
        `лента ${overdue}, статистика ${stats.body.data?.overdueStages}`,
      )
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

  // ── Главная не выдаёт показанное за всё ───────────────────────────────────
  step('Счётчик проблем на главной совпадает со списками этапов')

  {
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

  // ── Лента рекомендаций — по важности ──────────────────────────────────────
  step('Лента рекомендаций — по важности, страницы устойчивы')

  {
    /*
     * Приоритет — перечисление LOW < MEDIUM < HIGH < CRITICAL, и сортировка
     * «по приоритету» по возрастанию ставит сверху наименее важное. Так и было:
     * лента открывалась рекомендацией средней важности, а критичные
     * просрочки стояли в самом низу. Проверяем тем же запросом, что делает
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

  // ── Устаревшая сессия не запирает вход ────────────────────────────────────
  step('Устаревшая сессия не запирает вход')

  {
    /*
     * Cookie сессии остался, а пользователя за ним нет — так бывает после
     * перезаливки демо-данных. Приложение получает 401 и ведёт на вход
     * с `reauth=1`; middleware обязан эту страницу пропустить. Раньше вход
     * возвращал на главную, главная — на вход, и экран оставался пустым.
     */
    const stale = { cookie: 'authjs.session-token=stale-session-from-yesterday' }
    const withReauth = await fetch(`${BASE_URL}/login?${REAUTH_PARAM}=1`, { headers: stale, redirect: 'manual' })
    check('со старым cookie вход с reauth открывается', withReauth.status === 200, `код ${withReauth.status}`)

    // Обычный заход на вход с живой сессией по-прежнему ведёт на главную.
    const plain = await fetch(`${BASE_URL}/login`, { headers: stale, redirect: 'manual' })
    check('без reauth вошедший уходит со входа на главную', plain.status === 307, `код ${plain.status}`)
  }

  // ── Блокировка входа называет себя ─────────────────────────────────────────
  step('Исчерпанные попытки входа отличимы от неверного пароля')

  {
    // Несуществующий адрес: так проверка не закрывает вход демо-учётной записи
    // и заодно доказывает, что код не выдаёт существование адреса.
    const email = `probe-${Date.now()}@example.invalid`
    const attempt = async (): Promise<string | null> => {
      // Своя пара запросов без общего состояния пробника: cookie csrf-токена
      // нужна только этой попытке.
      const csrf = await fetch(`${BASE_URL}/api/auth/csrf`)
      const cookie = (csrf.headers.getSetCookie?.() ?? [])
        .map((line) => line.split(';')[0])
        .join('; ')
      const { csrfToken } = (await csrf.json()) as { csrfToken: string }
      const response = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
        body: new URLSearchParams({ csrfToken, email, password: 'заведомо-неверный' }).toString(),
      })
      const location = response.headers.get('location') ?? ''
      return /[?&]code=([a-z_]+)/.exec(location)?.[1] ?? null
    }
    const codes: Array<string | null> = []
    for (let index = 0; index < 6; index += 1) codes.push(await attempt())
    check(
      'пять неудач — «неверные данные», шестая — «слишком много попыток»',
      codes.slice(0, 5).every((code) => code === 'credentials') && codes[5] === 'too_many_attempts',
      codes.join(', '),
    )
  }

  // ── Итог ───────────────────────────────────────────────────────────────────
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

main().catch((error) => {
  console.error(`${RED}Пробник упал:${RESET}`, error)
  process.exitCode = 1
})
