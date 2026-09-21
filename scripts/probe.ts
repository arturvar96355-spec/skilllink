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

async function main(): Promise<void> {
  console.log(`${BOLD}Пробник SkillLink${RESET}`)
  console.log(`${GREY}Сервер: ${BASE_URL}${RESET}`)

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
