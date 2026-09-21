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

    const collected: string[] = []
    for (let page = 1; page <= 40; page += 1) {
      const chunk = await call<Array<{ id: string }>>(
        'GET',
        `/api/universities?pageSize=3&page=${page}&sort=-rating`,
      )
      const rows = chunk.body.data ?? []
      if (rows.length === 0) break
      collected.push(...rows.map((row) => row.id))
    }

    check(
      'постраничный обход по рейтингу ничего не теряет',
      collected.length === expectedOrder.length,
      `собрано ${collected.length}, ожидалось ${expectedOrder.length}`,
    )
    check('постраничный обход не повторяет записи', new Set(collected).size === collected.length)
    check(
      'порядок при обходе по страницам совпадает с одной выдачей',
      collected.join(',') === expectedOrder.join(','),
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
