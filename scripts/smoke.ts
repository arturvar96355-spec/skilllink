/**
 * Сквозной сценарий SkillLink: frontend → API → backend → database.
 * Повторяет демонстрационный сценарий из раздела 18 ТЗ и проверки из раздела 17.
 *
 * Запуск: npm run dev, затем в другом окне npm run smoke
 */
import 'dotenv/config'
import { CONTROL_POINT_STAGES } from '@/shared/config/workflow.config'

const BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:3000'

let passed = 0
let failed = 0
const failures: string[] = []

const GREEN = '[32m'
const RED = '[31m'
const GREY = '[90m'
const BOLD = '[1m'
const RESET = '[0m'

interface ApiResult<T> {
  status: number
  body: {
    data?: T
    meta?: Record<string, unknown>
    error?: { code: string; message: string; details?: unknown }
  }
}

/** Пользователь, от имени которого идут запросы в демо-режиме (решение 9). */
let currentUserId: string | null = null

/** Cookie настоящей сессии: NextAuth выдаёт их при входе по паролю. */
const cookieJar = new Map<string, string>()

function actAs(userId: string | null): void {
  currentUserId = userId
}

function clearSession(): void {
  cookieJar.clear()
}

function buildCookieHeader(): string {
  const parts = [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`)
  if (currentUserId) parts.push(`skilllink_user=${currentUserId}`)
  return parts.join('; ')
}

/** Запоминает cookie из ответа, чтобы следующий запрос шёл уже с сессией. */
function rememberCookies(response: Response): void {
  const raw = response.headers.getSetCookie?.() ?? []
  for (const entry of raw) {
    const [pair] = entry.split(';')
    if (!pair) continue
    const separator = pair.indexOf('=')
    if (separator <= 0) continue
    const name = pair.slice(0, separator).trim()
    const value = pair.slice(separator + 1).trim()
    if (value === '' || value === 'deleted') cookieJar.delete(name)
    else cookieJar.set(name, value)
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  const cookieHeader = buildCookieHeader()
  if (cookieHeader !== '') headers.cookie = cookieHeader

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    redirect: 'manual',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  rememberCookies(response)
  const text = await response.text()
  let parsed: ApiResult<T>['body']
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = {
      error: { code: 'INTERNAL', message: `Ответ не является JSON: ${text.slice(0, 200)}` },
    }
  }
  return { status: response.status, body: parsed }
}

/**
 * Все строки списка, по страницам.
 *
 * Один запрос с `pageSize=50` видит только первые пятьдесят. На рабочей базе,
 * где пробник и прошлые прогоны оставили записи, нужная рекомендация уезжала
 * на вторую страницу, и проверка «сработало правило» падала без ошибки
 * в приложении.
 */
async function callAll<T>(path: string): Promise<{ status: number; rows: T[]; total: number }> {
  const separator = path.includes('?') ? '&' : '?'
  const rows: T[] = []
  let status = 0
  let total = 0
  for (let page = 1; page <= 50; page += 1) {
    const result = await call<T[]>('GET', `${path}${separator}page=${page}&pageSize=100`)
    status = result.status
    total = Number(result.body.meta?.total ?? 0)
    rows.push(...(result.body.data ?? []))
    if (result.status !== 200 || rows.length >= total || (result.body.data ?? []).length === 0) break
  }
  return { status, rows, total }
}

/**
 * Запрос за файлом: выгрузка отдаёт CSV, а не JSON.
 *
 * Тело читается байтами: `response.text()` по спецификации удаляет BOM при декодировании,
 * а BOM здесь — ровно то, ради чего файл открывается в Excel без кракозябр.
 */
async function fetchRaw(path: string): Promise<{
  status: number
  headers: Headers
  text: string
  bytes: Uint8Array
}> {
  const cookieHeader = buildCookieHeader()
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: cookieHeader === '' ? {} : { cookie: cookieHeader },
    redirect: 'manual',
  })
  rememberCookies(response)

  const bytes = new Uint8Array(await response.arrayBuffer())
  return {
    status: response.status,
    headers: response.headers,
    text: new TextDecoder('utf-8').decode(bytes),
    bytes,
  }
}

/** Отправка файла CSV: загрузка принимает тело как есть, а не JSON. */
async function postCsv(path: string, csv: string): Promise<{ status: number; body: unknown }> {
  const cookieHeader = buildCookieHeader()
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'text/csv',
      ...(cookieHeader === '' ? {} : { cookie: cookieHeader }),
    },
    body: csv,
    redirect: 'manual',
  })
  rememberCookies(response)
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : {} }
}

/** Начинается ли файл с UTF-8 BOM (EF BB BF). */
function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
}

/** Пользователь из ответа /api/auth/session. Без сессии NextAuth отдаёт литеральный null. */
function sessionUserOf(result: ApiResult<unknown>): { id?: string; role?: string } | null {
  const body = result.body as unknown as { user?: { id?: string; role?: string } } | null
  return body?.user ?? null
}

/** NextAuth принимает вход формой, а не JSON. */
async function postForm(path: string, fields: Record<string, string>): Promise<number> {
  const cookieHeader = buildCookieHeader()
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookieHeader === '' ? {} : { cookie: cookieHeader }),
    },
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
  })
  rememberCookies(response)
  return response.status
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

interface Identified {
  id: string
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
        headers: currentUserId ? { cookie: `skilllink_user=${currentUserId}` } : {},
      })
        .then((response) => response.arrayBuffer())
        .catch(() => undefined),
    ),
  )
}

async function main(): Promise<void> {
  console.log(`${BOLD}Сквозной сценарий SkillLink${RESET}`)
  console.log(`${GREY}Сервер: ${BASE_URL}${RESET}`)

  await warmUp()

  // ── 1. Подключение ─────────────────────────────────────────────────────────
  step('1. Проверка подключения к базе данных')
  const health = await call<{ status: string; database: string }>('GET', '/api/health')
  check('GET /api/health отвечает 200', health.status === 200, `статус ${health.status}`)
  check('база данных подключена', health.body.data?.database === 'connected')

  if (health.status !== 200) {
    console.log(`\n${RED}Сервер не отвечает. Запустите npm run dev и повторите.${RESET}`)
    process.exitCode = 1
    return
  }

  // ── 2. Дашборд ─────────────────────────────────────────────────────────────
  step('2. Dashboard: сводные показатели')
  const overview = await call<{
    metrics: Array<{ key: string; value: number | null; basis: string; explanation: string }>
    topPrograms: Array<{ programName: string; score: number | null }>
    problemCooperations: unknown[]
    priorityActions: unknown[]
    skillMatch: { coveragePercent: number | null; isMock: boolean }
    containsMockData: boolean
  }>('GET', '/api/analytics/overview')
  check('GET /api/analytics/overview отвечает 200', overview.status === 200)
  const metrics = overview.body.data?.metrics ?? []
  check('показатели дашборда получены', metrics.length >= 4, `${metrics.length} показателей`)
  check(
    'у каждого показателя есть происхождение',
    metrics.every((metric) => typeof metric.basis === 'string' && metric.explanation.length > 0),
  )
  check(
    'показатель без данных отдаёт null, а не ноль',
    metrics.every((metric) => metric.basis !== 'none' || metric.value === null),
  )
  check('демонстрационные данные помечены', overview.body.data?.containsMockData === true)
  check(
    'топ программ рассчитан',
    (overview.body.data?.topPrograms.length ?? 0) > 0,
    `${overview.body.data?.topPrograms.length ?? 0} программ`,
  )
  check(
    'проблемные связи показаны',
    (overview.body.data?.problemCooperations.length ?? 0) > 0,
    `${overview.body.data?.problemCooperations.length ?? 0} записей`,
  )
  check(
    'блок приоритетных действий присутствует в ответе',
    Array.isArray(overview.body.data?.priorityActions),
  )

  // ── 3. Реестр вузов ────────────────────────────────────────────────────────
  step('3. Реестр университетов')
  const universities = await call<Array<Identified & { name: string; programCount: number }>>(
    'GET',
    '/api/universities?pageSize=50',
  )
  check('GET /api/universities отвечает 200', universities.status === 200)
  const universityList = universities.body.data ?? []
  check('вузы получены', universityList.length > 0, `${universityList.length} записей`)
  check('в meta есть пагинация', typeof universities.body.meta?.total === 'number')
  check('показано количество программ', universityList.every((u) => typeof u.programCount === 'number'))

  const search = await call<unknown[]>('GET', '/api/universities?q=связи')
  check('поиск по названию работает', search.status === 200, `найдено ${search.body.data?.length ?? 0}`)

  const filtered = await call<unknown[]>('GET', '/api/universities?status=ACTIVE')
  check('фильтр по статусу работает', filtered.status === 200, `найдено ${filtered.body.data?.length ?? 0}`)

  // ── 4. Карточка вуза ───────────────────────────────────────────────────────
  step('4. Карточка университета')
  const firstUniversity = universityList[0]
  if (!firstUniversity) {
    check('есть хотя бы один вуз', false, 'запустите npm run db:seed')
    return
  }
  const universityCard = await call<{ name: string; primaryContact: unknown; contacts: unknown[] }>(
    'GET',
    `/api/universities/${firstUniversity.id}`,
  )
  check('карточка вуза открывается', universityCard.status === 200)
  check('контактное лицо отдаётся', universityCard.body.data?.primaryContact !== undefined)

  const missing = await call('GET', '/api/universities/no-such-id')
  check('несуществующий вуз отдаёт 404', missing.status === 404, `код ${missing.body.error?.code}`)
  check('ошибка содержит код', missing.body.error?.code === 'NOT_FOUND')

  // ── 5. Создание вуза и программы ───────────────────────────────────────────
  step('5. Создание университета и образовательной программы')
  const suffix = Date.now().toString().slice(-6)
  const newUniversity = await call<Identified>('POST', '/api/universities', {
    name: `Проверочный университет связи ${suffix}`,
    city: 'Тверь',
    region: 'Тверская область',
    status: 'IN_PROGRESS',
    contacts: [
      { fullName: 'Проверочный Контакт Смоук', position: 'Заведующий кафедрой', isPrimary: true },
    ],
  })
  check('POST /api/universities отвечает 201', newUniversity.status === 201, `статус ${newUniversity.status}`)
  const universityId = newUniversity.body.data?.id
  check('идентификатор вуза получен', Boolean(universityId))

  const invalidUniversity = await call('POST', '/api/universities', {
    name: 'АБ',
    city: '',
    region: '',
  })
  check(
    'некорректные данные отклоняются с 422',
    invalidUniversity.status === 422,
    `код ${invalidUniversity.body.error?.code}`,
  )
  check(
    'текст ошибки на русском',
    /[а-яА-Я]/.test(invalidUniversity.body.error?.message ?? ''),
    invalidUniversity.body.error?.message,
  )
  check('в ошибке есть разбор по полям', Array.isArray(invalidUniversity.body.error?.details))

  if (!universityId) return

  const newProgram = await call<Identified>('POST', '/api/programs', {
    universityId,
    name: `Проверочная программа ${suffix}`,
    level: 'BACHELOR',
    durationMonths: 48,
    applicationCount: 210,
    studentCount: 85,
    groupCount: 3,
  })
  check('POST /api/programs отвечает 201', newProgram.status === 201, `статус ${newProgram.status}`)
  const programId = newProgram.body.data?.id
  check('идентификатор программы получен', Boolean(programId))

  const foreignProgram = await call('POST', '/api/programs', {
    universityId: 'no-such-university',
    name: 'Программа несуществующего вуза',
    level: 'MASTER',
  })
  check('программа для несуществующего вуза отклоняется', foreignProgram.status === 422)

  if (!programId) return

  // ── 6. Привязка навыков ────────────────────────────────────────────────────
  step('6. Привязка навыков к программе')
  const skills = await call<Array<Identified & { name: string }>>('GET', '/api/skills?pageSize=5')
  check('GET /api/skills отвечает 200', skills.status === 200)
  const skillIds = (skills.body.data ?? []).slice(0, 3).map((skill) => skill.id)
  check('навыки получены', skillIds.length === 3)

  const attached = await call<{ skills: unknown[] }>('PUT', `/api/programs/${programId}/skills`, {
    skills: [
      { skillId: skillIds[0], level: 'ADVANCED', importance: 'CRITICAL' },
      { skillId: skillIds[1], level: 'INTERMEDIATE', importance: 'HIGH' },
      { skillId: skillIds[2], level: 'BASIC', importance: 'MEDIUM' },
    ],
  })
  check('навыки привязаны', attached.status === 200)
  check('в программе три навыка', attached.body.data?.skills.length === 3)

  const badSkill = await call('PUT', `/api/programs/${programId}/skills`, {
    skills: [{ skillId: 'no-such-skill' }],
  })
  check('несуществующий навык отклоняется', badSkill.status === 422)

  // ── 7. IT-продукты ─────────────────────────────────────────────────────────
  step('7. IT-продукты')
  const products = await call<Array<Identified & { name: string }>>('GET', '/api/products')
  check('GET /api/products отвечает 200', products.status === 200)
  const productId = products.body.data?.[0]?.id
  check('продукты получены', Boolean(productId), `${products.body.data?.length ?? 0} продуктов`)

  const productCard = await call('GET', `/api/products/${productId}`)
  check('карточка продукта открывается', productCard.status === 200)

  // ── 7a. Списки и сортировка ────────────────────────────────────────────────
  step('7a. Списки программ: пагинация, фильтры, сортировка')
  const programList = await call<Array<{ id: string; metrics: Record<string, { value: number | null }> }>>(
    'GET',
    '/api/programs?pageSize=50',
  )
  check('GET /api/programs отвечает 200', programList.status === 200, `статус ${programList.status}`)
  check('программы получены', (programList.body.data?.length ?? 0) > 0, `${programList.body.data?.length ?? 0} программ`)

  const sortedByMetric = await call<unknown[]>('GET', '/api/programs?sort=-applicationCount')
  check(
    'сортировка по показателю набора работает',
    sortedByMetric.status === 200,
    `статус ${sortedByMetric.status}`,
  )

  // Архивирование и возврат — парные операции.
  const archivable = await call<{ id: string }>('POST', '/api/programs', {
    universityId,
    name: `Программа для архива ${suffix}`,
    level: 'DPO',
  })
  const archivableId = archivable.body.data?.id
  if (archivableId) {
    const archived = await call<{ status: string; archivedAt: string | null }>(
      'POST',
      `/api/programs/${archivableId}/archive`,
    )
    check('программа архивируется', archived.body.data?.status === 'ARCHIVED')
    check('дата архивирования проставлена', Boolean(archived.body.data?.archivedAt))

    // Сужаем по уникальному суффиксу: на рабочей базе программ больше сотни,
    // и по алфавиту «Программа для архива…» уезжала за первую страницу.
    const byName = `q=${encodeURIComponent(suffix)}`
    const hidden = await call<Array<{ id: string }>>('GET', `/api/programs?pageSize=100&${byName}`)
    check(
      'архивная программа скрыта из списка по умолчанию',
      !(hidden.body.data ?? []).some((item) => item.id === archivableId),
    )

    const visible = await call<Array<{ id: string }>>(
      'GET',
      `/api/programs?pageSize=100&includeArchived=true&${byName}`,
    )
    check(
      'архивную программу видно по явному запросу',
      (visible.body.data ?? []).some((item) => item.id === archivableId),
    )

    const restored = await call<{ status: string; archivedAt: string | null }>(
      'POST',
      `/api/programs/${archivableId}/restore`,
    )
    check('программа возвращается из архива', restored.body.data?.status === 'ACTIVE')
    check('дата архивирования снята', restored.body.data?.archivedAt === null)
  }

  const sortedByName = await call<unknown[]>('GET', '/api/programs?sort=name')
  check('сортировка по названию работает', sortedByName.status === 200, `статус ${sortedByName.status}`)

  const byLevel = await call<unknown[]>('GET', '/api/programs?level=MASTER')
  check('фильтр по уровню образования работает', byLevel.status === 200)

  const sortedCooperations = await call<unknown[]>('GET', '/api/cooperations?sort=targetDate')
  check(
    'сортировка связок по контрольной дате работает',
    sortedCooperations.status === 200,
    `статус ${sortedCooperations.status}`,
  )

  // ── 8. Создание связки и 14 этапов ─────────────────────────────────────────
  step('8. Создание связки: вуз — программа — продукт')
  const existingCooperations = await call<Array<{ responsible: Identified }>>(
    'GET',
    '/api/cooperations?pageSize=1',
  )
  const managerId = existingCooperations.body.data?.[0]?.responsible.id
  check('ответственный найден в демо-данных', Boolean(managerId))

  const cooperation = await call<{
    id: string
    stages: Array<{
      id: string
      stageNumber: number
      status: string
      isAutoManaged: boolean
      tasks: Array<Identified & { isRequired: boolean }>
    }>
    progress: { percent: number; totalStages: number }
    currentStage: { stageNumber: number } | null
  }>('POST', '/api/cooperations', {
    universityId,
    programId,
    productId,
    responsibleId: managerId,
    goal: 'Проверочная связка сквозного сценария',
    classesStartAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  })
  check(
    'POST /api/cooperations отвечает 201',
    cooperation.status === 201,
    `статус ${cooperation.status} ${cooperation.body.error?.message ?? ''}`,
  )

  const stages = cooperation.body.data?.stages ?? []
  check('создано ровно 14 этапов', stages.length === 14, `${stages.length} этапов`)
  check(
    'номера этапов идут с 1 по 14',
    stages.map((stage) => stage.stageNumber).join(',') ===
      Array.from({ length: 14 }, (_, index) => index + 1).join(','),
  )
  check('этап 14 помечен как вычисляемый', stages[13]?.isAutoManaged === true)
  check('чек-листы созданы', stages.slice(0, 13).every((stage) => stage.tasks.length > 0))
  check('текущий этап — первый', cooperation.body.data?.currentStage?.stageNumber === 1)
  check('прогресс на старте равен 0', cooperation.body.data?.progress.percent === 0)
  check('в прогресс входят 13 этапов', cooperation.body.data?.progress.totalStages === 13)

  const cooperationId = cooperation.body.data?.id

  // Вторая незакрытая связка на тот же «вуз + программа + продукт» не заводится.
  const duplicateCooperation = await call<unknown>('POST', '/api/cooperations', {
    universityId,
    programId,
    productId,
    responsibleId: managerId,
  })
  const duplicateDetails = duplicateCooperation.body.error?.details as
    | { cooperationId?: string }
    | undefined
  check(
    'дубль связки отклоняется с 409',
    duplicateCooperation.status === 409,
    `статус ${duplicateCooperation.status}`,
  )
  check(
    'в отказе — ссылка на существующую связку',
    duplicateDetails?.cooperationId === cooperationId,
    duplicateCooperation.body.error?.message,
  )

  const stage1 = stages[0]
  const stage2 = stages[1]
  const stage3 = stages[2]
  const controlStage = stages[13]
  if (!cooperationId || !stage1 || !stage2 || !stage3 || !controlStage) return

  // ── 9. Работа с этапом ─────────────────────────────────────────────────────
  step('9. Текущий этап, чек-лист и смена статуса')
  const started = await call<{ status: string; startedAt: string | null }>(
    'PATCH',
    `/api/workflow/stages/${stage1.id}`,
    { status: 'IN_PROGRESS' },
  )
  check(
    'этап переведён в работу',
    started.status === 200 && started.body.data?.status === 'IN_PROGRESS',
  )
  check('зафиксировано время начала', Boolean(started.body.data?.startedAt))

  const tooEarly = await call('PATCH', `/api/workflow/stages/${stage1.id}`, {
    status: 'COMPLETED',
    result: 'Попытка закрыть этап с незакрытым чек-листом',
  })
  check(
    'этап не закрывается с незакрытыми обязательными пунктами',
    tooEarly.status === 409 && tooEarly.body.error?.code === 'INVALID_TRANSITION',
    `код ${tooEarly.body.error?.code}`,
  )

  const requiredTasks = stage1.tasks.filter((task) => task.isRequired)
  for (const task of requiredTasks) {
    await call('PATCH', `/api/workflow/tasks/${task.id}`, { isDone: true })
  }
  check(
    'обязательные пункты чек-листа закрыты',
    requiredTasks.length > 0,
    `${requiredTasks.length} пунктов`,
  )

  const noResult = await call('PATCH', `/api/workflow/stages/${stage1.id}`, { status: 'COMPLETED' })
  check('этап не закрывается без результата', noResult.status === 422, `код ${noResult.body.error?.code}`)

  const completed = await call<{ status: string; completedAt: string | null; completedBy: unknown }>(
    'PATCH',
    `/api/workflow/stages/${stage1.id}`,
    { status: 'COMPLETED', result: 'Контакт найден, договорённость о встрече достигнута' },
  )
  check('этап завершён', completed.status === 200 && completed.body.data?.status === 'COMPLETED')
  check('сохранена дата завершения', Boolean(completed.body.data?.completedAt))
  check('сохранён автор завершения', completed.body.data?.completedBy !== null)

  const invalidJump = await call('PATCH', `/api/workflow/stages/${stage3.id}`, {
    status: 'COMPLETED',
    result: 'Попытка перескочить статус',
  })
  check(
    'переход NOT_STARTED в COMPLETED запрещён',
    invalidJump.status === 409,
    `код ${invalidJump.body.error?.code}`,
  )

  const stage2Started = await call('PATCH', `/api/workflow/stages/${stage2.id}`, {
    status: 'IN_PROGRESS',
  })
  check('этап 2 переведён в работу', stage2Started.status === 200)

  const blockedWithoutReason = await call('PATCH', `/api/workflow/stages/${stage2.id}`, {
    status: 'BLOCKED',
  })
  check('блокировка без причины отклоняется', blockedWithoutReason.status === 422)

  const blocked = await call<{ status: string; blockingReason: string | null }>(
    'PATCH',
    `/api/workflow/stages/${stage2.id}`,
    { status: 'BLOCKED', blockingReason: 'Вуз не отвечает на письма' },
  )
  check('этап заблокирован с причиной', blocked.body.data?.status === 'BLOCKED')
  check('причина блокировки сохранена', Boolean(blocked.body.data?.blockingReason))

  const reopenWithoutComment = await call('PATCH', `/api/workflow/stages/${stage1.id}`, {
    status: 'IN_PROGRESS',
  })
  check('переоткрытие без комментария отклоняется', reopenWithoutComment.status === 422)

  const controlAttempt = await call('PATCH', `/api/workflow/stages/${controlStage.id}`, {
    status: 'COMPLETED',
    result: 'Попытка закрыть контрольный этап вручную',
  })
  check(
    'контрольный этап 14 нельзя изменить вручную',
    controlAttempt.status === 409,
    `код ${controlAttempt.body.error?.code}`,
  )

  // ── 10. Прогресс и история ─────────────────────────────────────────────────
  step('10. Прогресс и история изменений обновились')
  const refreshed = await call<{
    progress: { percent: number; blockedStages: number; completedStages: number }
    currentStage: { stageNumber: number; status: string } | null
    stages: Array<{ stageNumber: number; status: string }>
  }>('GET', `/api/cooperations/${cooperationId}`)
  check('связка перечитана', refreshed.status === 200)
  check(
    'прогресс вырос',
    (refreshed.body.data?.progress.percent ?? 0) > 0,
    `${refreshed.body.data?.progress.percent}%`,
  )
  check('заблокированный этап учтён', refreshed.body.data?.progress.blockedStages === 1)
  check(
    'текущий этап сместился на второй',
    refreshed.body.data?.currentStage?.stageNumber === 2,
    `этап ${refreshed.body.data?.currentStage?.stageNumber}`,
  )
  check(
    'контрольный этап пересчитан автоматически',
    refreshed.body.data?.stages.find((stage) => stage.stageNumber === 14)?.status === 'IN_PROGRESS',
  )

  const history = await call<
    Array<{ fromStatus: string | null; toStatus: string; changedBy: unknown }>
  >('GET', `/api/workflow/stages/${stage1.id}/history`)
  check('история этапа получена', history.status === 200)
  check(
    'в истории две записи',
    (history.body.data?.length ?? 0) === 2,
    `${history.body.data?.length ?? 0} записей`,
  )
  check('в истории есть автор изменения', history.body.data?.[0]?.changedBy !== undefined)

  const stagesList = await call<unknown[]>('GET', `/api/cooperations/${cooperationId}/stages`)
  check('GET /api/cooperations/:id/stages отвечает 200', stagesList.status === 200)
  check('вернулись все 14 этапов', (stagesList.body.data?.length ?? 0) === 14)

  // ── 11. Просроченные и заблокированные ─────────────────────────────────────
  step('11. Просроченные и заблокированные этапы')
  const overdue = await call<unknown[]>('GET', '/api/workflow/overdue')
  check('GET /api/workflow/overdue отвечает 200', overdue.status === 200)
  check(
    'просроченные этапы найдены',
    (overdue.body.data?.length ?? 0) > 0,
    `${overdue.body.data?.length ?? 0} этапов`,
  )

  const blockedList = await call<unknown[]>('GET', '/api/workflow/blocked')
  check('GET /api/workflow/blocked отвечает 200', blockedList.status === 200)
  check(
    'заблокированные этапы найдены',
    (blockedList.body.data?.length ?? 0) > 0,
    `${blockedList.body.data?.length ?? 0} этапов`,
  )

  // ── 12. Навыки, спрос, дефициты ────────────────────────────────────────────
  step('12. Востребованность навыков и skill gap')
  const demand = await call<
    Array<{ normalized: number | null; source: string | null; isMock: boolean }>
  >('GET', '/api/skills/demand')
  check('GET /api/skills/demand отвечает 200', demand.status === 200)
  check('спрос получен', (demand.body.data?.length ?? 0) > 0, `${demand.body.data?.length} навыков`)
  check(
    'у каждой строки есть источник',
    (demand.body.data ?? []).every((row) => row.source !== null),
  )
  check('демонстрационные данные помечены', demand.body.meta?.isMock === true)
  check('период указан', typeof demand.body.meta?.period === 'string', String(demand.body.meta?.period))

  const gaps = await call<Array<{ isCritical: boolean; explanation: string }>>(
    'GET',
    `/api/skills/gaps?programId=${programId}`,
  )
  check('GET /api/skills/gaps отвечает 200', gaps.status === 200)
  check('дефициты рассчитаны', (gaps.body.data?.length ?? 0) > 0, `${gaps.body.data?.length} навыков`)
  check(
    'у каждого дефицита есть объяснение',
    (gaps.body.data ?? []).every((row) => row.explanation.length > 0),
  )

  const criticalGaps = await call<Array<{ name: string; coverage: number }>>(
    'GET',
    '/api/skills/gaps?criticalOnly=true',
  )
  check('фильтр критичных дефицитов работает', criticalGaps.status === 200)
  check(
    'критичные дефициты найдены',
    (criticalGaps.body.data?.length ?? 0) > 0,
    (criticalGaps.body.data ?? []).map((row) => row.name).join(', '),
  )
  check(
    'критичный дефицит — это навык, которого нет ни в одной программе',
    (criticalGaps.body.data ?? []).every((row) => row.coverage === 0),
  )

  // ── 13. Рейтинг программ ───────────────────────────────────────────────────
  step('13. Рейтинг программ с раскрытием вклада показателей')
  const rating = await call<
    Array<{
      score: number | null
      basis: string
      factors: Array<{ key: string; contribution: number | null }>
    }>
  >('GET', '/api/analytics/programs?limit=20')
  check('GET /api/analytics/programs отвечает 200', rating.status === 200)
  const ranked = rating.body.data ?? []
  check('рейтинг рассчитан', ranked.length > 0, `${ranked.length} программ`)
  check(
    'у каждой программы ровно три показателя',
    ranked.every((program) => program.factors.length === 3),
  )
  check(
    'программы без данных не получают выдуманный балл',
    ranked.every((program) => program.basis !== 'none' || program.score === null),
  )

  // ── 14. Связки: фильтры и изменение ────────────────────────────────────────
  step('14. Раздел сотрудничества: списки, фильтры, изменение')
  const cooperations = await call<unknown[]>('GET', '/api/cooperations?pageSize=50')
  check('GET /api/cooperations отвечает 200', cooperations.status === 200)
  check(
    'связки получены',
    (cooperations.body.data?.length ?? 0) > 0,
    `${cooperations.body.data?.length} связок`,
  )

  const overdueCooperations = await call<unknown[]>('GET', '/api/cooperations?onlyOverdue=true')
  check(
    'фильтр просроченных связок работает',
    overdueCooperations.status === 200,
    `${overdueCooperations.body.data?.length ?? 0} связок`,
  )

  const patched = await call<{ goal: string | null }>('PATCH', `/api/cooperations/${cooperationId}`, {
    goal: 'Уточнённая цель сотрудничества',
  })
  check('связка изменяется', patched.status === 200 && patched.body.data?.goal !== null)

  const emptyPatch = await call('PATCH', `/api/cooperations/${cooperationId}`, {})
  check('пустое тело изменения отклоняется', emptyPatch.status === 422, `код ${emptyPatch.body.error?.code}`)

  // ── 15. Рекомендации ───────────────────────────────────────────────────────
  step('15. Рекомендации: генерация, основание, работа сотрудника')
  const generated = await call<{ created: number; updated: number; closed: number; total: number }>(
    'POST',
    '/api/recommendations/generate',
  )
  check('POST /api/recommendations/generate отвечает 200', generated.status === 200)
  check(
    'рекомендации сформированы',
    (generated.body.data?.total ?? 0) > 0,
    `всего ${generated.body.data?.total ?? 0}, создано ${generated.body.data?.created ?? 0}`,
  )

  const recommendations = await callAll<{
    id: string
    ruleKey: string
    title: string
    justification: string
    priority: string
    confidence: string
    status: string
    relatedData: Record<string, unknown> | null
  }>('/api/recommendations')
  check('GET /api/recommendations отвечает 200', recommendations.status === 200)
  const recs = recommendations.rows
  check('рекомендации получены', recs.length > 0, `${recs.length} штук`)
  check(
    'у каждой рекомендации есть основание',
    recs.every((rec) => rec.justification.length > 0),
  )
  check(
    'у каждой рекомендации есть связанные данные',
    recs.every((rec) => rec.relatedData !== null),
  )
  check(
    'у каждой рекомендации есть приоритет и уверенность',
    recs.every((rec) => rec.priority.length > 0 && rec.confidence.length > 0),
  )
  check(
    'сработало несколько разных правил',
    new Set(recs.map((rec) => rec.ruleKey)).size > 1,
    [...new Set(recs.map((rec) => rec.ruleKey))].join(', '),
  )
  // Каждое правило должно быть видно на демонстрации, иначе часть движка не показать.
  const EXPECTED_RULES = [
    'stage.overdue',
    'cooperation.stalled',
    'cooperation.no-product',
    'program.missing-metrics',
    'skill.critical-gap-with-product',
  ]
  const firedRules = new Set(recs.map((rec) => rec.ruleKey))
  for (const rule of EXPECTED_RULES) {
    check(`сработало правило ${rule}`, firedRules.has(rule))
  }

  // Повторная генерация не должна плодить дубликаты.
  const regenerated = await call<{ created: number; total: number }>(
    'POST',
    '/api/recommendations/generate',
  )
  check(
    'повторная генерация не создаёт дубликаты',
    regenerated.body.data?.created === 0,
    `создано заново: ${regenerated.body.data?.created}`,
  )

  // Сравнивается общее число, а не длина страницы: при сотне записей страница
  // в пятьдесят строк одинакова до и после, и дубликаты прошли бы незамеченными.
  const afterRegen = await call<unknown[]>('GET', '/api/recommendations?pageSize=1')
  const totalAfter = Number(afterRegen.body.meta?.total ?? -1)
  check(
    'количество рекомендаций не выросло',
    totalAfter === recommendations.total,
    `было ${recommendations.total}, стало ${totalAfter}`,
  )

  const firstRec = recs[0]
  if (firstRec) {
    const dismissNoComment = await call('PATCH', `/api/recommendations/${firstRec.id}`, {
      status: 'DISMISSED',
    })
    check('отклонение без основания отклоняется', dismissNoComment.status === 422)

    const accepted = await call<{ status: string; resolvedAt: string | null }>(
      'PATCH',
      `/api/recommendations/${firstRec.id}`,
      { status: 'ACCEPTED', comment: 'Взято в работу' },
    )
    check('рекомендация принимается', accepted.body.data?.status === 'ACCEPTED')
    check('зафиксировано время решения', Boolean(accepted.body.data?.resolvedAt))

    const afterAccept = await call<{ status: string; justification: string }>(
      'GET',
      `/api/recommendations/${firstRec.id}`,
    )
    check(
      'обоснование системы не переписано комментарием сотрудника',
      afterAccept.body.data?.justification === firstRec.justification,
    )

    // Пересборка не должна возвращать принятую рекомендацию в статус NEW.
    await call('POST', '/api/recommendations/generate')
    const afterRerun = await call<{ status: string }>('GET', `/api/recommendations/${firstRec.id}`)
    check(
      'решение сотрудника переживает пересборку',
      afterRerun.body.data?.status === 'ACCEPTED',
      `статус ${afterRerun.body.data?.status}`,
    )
  }

  const byPriority = await call<unknown[]>('GET', '/api/recommendations?priority=HIGH&priority=CRITICAL')
  check('фильтр по приоритету работает', byPriority.status === 200)

  const dashboardWithActions = await call<{
    priorityActions: Array<{ title: string; justification: string; priority: string }>
  }>('GET', '/api/analytics/overview')
  const actions = dashboardWithActions.body.data?.priorityActions ?? []
  check('блок приоритетных действий заполнен', actions.length > 0, `${actions.length} действий`)
  check(
    'у каждого приоритетного действия есть основание',
    actions.every((action) => action.justification.length > 0),
  )
  check(
    'критичные и важные действия наверху',
    actions.length === 0 || ['CRITICAL', 'HIGH'].includes(actions[0]?.priority ?? ''),
    `первый приоритет: ${actions[0]?.priority}`,
  )

  // ── 16. Документы ──────────────────────────────────────────────────────────
  step('16. Документы: метаданные, жизненный цикл, история, версии')
  const documents = await call<Array<{ id: string; status: string; links: { cooperationId: string | null } }>>(
    'GET',
    '/api/documents?pageSize=50',
  )
  check('GET /api/documents отвечает 200', documents.status === 200)
  check('документы получены', (documents.body.data?.length ?? 0) > 0, `${documents.body.data?.length ?? 0} штук`)

  const byCooperation = await call<unknown[]>('GET', `/api/documents?cooperationId=${cooperationId}`)
  check('фильтр документов по связке работает', byCooperation.status === 200)

  const noLink = await call('POST', '/api/documents', {
    type: 'AGREEMENT',
    title: 'Документ без привязки',
  })
  check('документ без привязки отклоняется', noLink.status === 422, `код ${noLink.body.error?.code}`)

  const newDocument = await call<{ id: string; version: string; status: string }>(
    'POST',
    '/api/documents',
    {
      cooperationId,
      type: 'AGREEMENT',
      title: 'Договор сквозного сценария',
      fileReference: 'https://example.invalid/docs/smoke.pdf',
    },
  )
  check('POST /api/documents отвечает 201', newDocument.status === 201, `статус ${newDocument.status}`)
  check('версия по умолчанию — 1', newDocument.body.data?.version === '1')
  check('новый документ — черновик', newDocument.body.data?.status === 'DRAFT')

  const documentId = newDocument.body.data?.id
  if (documentId) {
    const skipReview = await call('PATCH', `/api/documents/${documentId}/status`, {
      status: 'SIGNED',
    })
    check(
      'нельзя подписать документ, минуя согласование',
      skipReview.status === 409,
      `код ${skipReview.body.error?.code}`,
    )

    const toReview = await call<{ status: string }>('PATCH', `/api/documents/${documentId}/status`, {
      status: 'REVIEW',
    })
    check('документ уходит на согласование', toReview.body.data?.status === 'REVIEW')

    const rejectNoComment = await call('PATCH', `/api/documents/${documentId}/status`, {
      status: 'REJECTED',
    })
    check('отклонение документа без основания отклоняется', rejectNoComment.status === 422)

    await call('PATCH', `/api/documents/${documentId}/status`, { status: 'APPROVED' })
    const signed = await call<{ status: string; signedAt: string | null; history: unknown[] }>(
      'PATCH',
      `/api/documents/${documentId}/status`,
      { status: 'SIGNED' },
    )
    check('документ подписан', signed.body.data?.status === 'SIGNED')
    check('дата подписания зафиксирована', Boolean(signed.body.data?.signedAt))
    check(
      'история статусов накопилась',
      (signed.body.data?.history.length ?? 0) === 3,
      `${signed.body.data?.history.length ?? 0} записей`,
    )

    const editSigned = await call('PATCH', `/api/documents/${documentId}`, {
      title: 'Попытка править подписанный документ',
    })
    check(
      'подписанный документ не редактируется',
      editSigned.status === 409,
      `код ${editSigned.body.error?.code}`,
    )

    const version2 = await call<{ id: string; version: string; status: string }>(
      'POST',
      `/api/documents/${documentId}/versions`,
    )
    check('создаётся новая версия', version2.status === 201, `версия ${version2.body.data?.version}`)
    check('номер версии увеличился', version2.body.data?.version === '2')
    check('новая версия — черновик', version2.body.data?.status === 'DRAFT')

    const oldVersion = await call<{ status: string }>('GET', `/api/documents/${documentId}`)
    check('прежняя версия ушла в архив', oldVersion.body.data?.status === 'ARCHIVED')
  }

  // ── 17. Встречи ────────────────────────────────────────────────────────────
  step('17. Встречи: участники, результат, следующее действие')
  const meetings = await call<Array<{ id: string; participants: unknown[] }>>(
    'GET',
    '/api/meetings?pageSize=50',
  )
  check('GET /api/meetings отвечает 200', meetings.status === 200)
  check('встречи получены', (meetings.body.data?.length ?? 0) > 0, `${meetings.body.data?.length ?? 0} штук`)
  check(
    'у встреч есть участники',
    (meetings.body.data ?? []).some((meeting) => meeting.participants.length > 0),
  )

  const actionNoDate = await call('POST', '/api/meetings', {
    cooperationId,
    date: new Date().toISOString(),
    topic: 'Встреча без срока следующего действия',
    responsibleId: managerId,
    nextAction: 'Отправить договор',
  })
  check(
    'следующее действие без срока отклоняется',
    actionNoDate.status === 422,
    `код ${actionNoDate.body.error?.code}`,
  )

  const badParticipant = await call('POST', '/api/meetings', {
    cooperationId,
    date: new Date().toISOString(),
    topic: 'Встреча с неизвестным участником',
    responsibleId: managerId,
    participants: [{ userId: 'no-such-user' }],
  })
  check('несуществующий участник отклоняется', badParticipant.status === 422)

  const newMeeting = await call<{ id: string; participants: Array<{ kind: string; name: string }> }>(
    'POST',
    '/api/meetings',
    {
      cooperationId,
      date: new Date().toISOString(),
      topic: 'Встреча сквозного сценария',
      format: 'ONLINE',
      responsibleId: managerId,
      result: 'Договорились о передаче материалов',
      nextAction: 'Передать учебные материалы',
      nextActionDueAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      participants: [{ userId: managerId }, { externalName: 'Внешний Участник Демо' }],
    },
  )
  check(
    'POST /api/meetings отвечает 201',
    newMeeting.status === 201,
    `статус ${newMeeting.status} ${newMeeting.body.error?.message ?? ''} ${JSON.stringify(newMeeting.body.error?.details ?? '')}`,
  )
  check('участники сохранены', newMeeting.body.data?.participants.length === 2)
  check(
    'типы участников различаются',
    new Set((newMeeting.body.data?.participants ?? []).map((p) => p.kind)).size === 2,
    (newMeeting.body.data?.participants ?? []).map((p) => p.kind).join(', '),
  )

  const meetingId = newMeeting.body.data?.id
  if (meetingId) {
    const updatedMeeting = await call<{ participants: unknown[]; result: string | null }>(
      'PATCH',
      `/api/meetings/${meetingId}`,
      { result: 'Уточнённый результат встречи', participants: [{ userId: managerId }] },
    )
    check('встреча изменяется', updatedMeeting.status === 200)
    check('состав участников заменяется целиком', updatedMeeting.body.data?.participants.length === 1)

    const emptyMeetingPatch = await call('PATCH', `/api/meetings/${meetingId}`, {})
    check('пустое тело изменения встречи отклоняется', emptyMeetingPatch.status === 422)
  }

  // ── 17a. Текущий пользователь и права ──────────────────────────────────────
  step('17a. Текущий пользователь и его права')
  const me = await call<{
    role: string
    permissions: { canWrite: boolean; canSeeAnalytics: boolean; canUsePortal: boolean }
  }>('GET', '/api/me')
  check('GET /api/me отвечает 200', me.status === 200)
  check('роль определена', Boolean(me.body.data?.role), me.body.data?.role)
  check('права переданы фронту', me.body.data?.permissions.canWrite === true)

  // ── 18. Кабинет представителя вуза ─────────────────────────────────────────
  step('18. Кабинет представителя вуза: свой вуз и только он')

  // Находим демо-представителя вуза среди пользователей, известных системе.
  const repProbe = await call<{ universityId: string; universityName: string }>(
    'GET',
    '/api/portal/overview',
  )
  check(
    'сотрудник без указания вуза не попадает в кабинет',
    repProbe.status === 404,
    `код ${repProbe.body.error?.code}`,
  )

  const ownUniversity = universityList[0]
  if (!ownUniversity) return

  const staffPortal = await call<{ universityId: string; programs: unknown[] }>(
    'GET',
    `/api/portal/overview?universityId=${ownUniversity.id}`,
  )
  check('сотрудник открывает кабинет любого вуза по идентификатору', staffPortal.status === 200)

  // Дальше работаем от имени представителя вуза: находим его в справочнике пользователей.
  const repUsers = await call<Array<{ id: string; universityId: string | null; fullName: string }>>(
    'GET',
    '/api/users?role=UNIVERSITY_REP',
  )
  check('GET /api/users отвечает 200', repUsers.status === 200)
  const repUserId = repUsers.body.data?.[0]?.id
  check('представитель вуза найден в справочнике', Boolean(repUserId), repUsers.body.data?.[0]?.fullName)

  if (!repUserId) {
    check('демо-представитель вуза загружен: запустите npm run db:seed', false)
  } else {
    actAs(repUserId)

    const portal = await call<{
      universityId: string
      universityName: string
      programs: Array<{ id: string; studentCount: number | null; groupCount: number | null }>
      cooperations: unknown[]
      pendingMaterials: number
    }>('GET', '/api/portal/overview')
    check('представитель открывает свой кабинет', portal.status === 200)
    check('кабинет показывает свой вуз', Boolean(portal.body.data?.universityName), portal.body.data?.universityName)
    check('в кабинете есть программы вуза', (portal.body.data?.programs.length ?? 0) > 0)
    check('в кабинете есть связки вуза', (portal.body.data?.cooperations.length ?? 0) > 0)

    const repUniversityId = portal.body.data?.universityId

    // Видимость: только свой вуз.
    const repUniversities = await call<Array<{ id: string }>>('GET', '/api/universities?pageSize=50')
    check(
      'представитель видит только свой вуз в реестре',
      (repUniversities.body.data?.length ?? 0) === 1,
      `${repUniversities.body.data?.length ?? 0} вузов`,
    )

    const foreignUniversity = universityList.find((item) => item.id !== repUniversityId)
    if (foreignUniversity) {
      const foreign = await call('GET', `/api/universities/${foreignUniversity.id}`)
      check(
        'чужой вуз отдаёт 404, а не 403',
        foreign.status === 404,
        `код ${foreign.body.error?.code}`,
      )
    }

    const foreignCooperation = await call('GET', `/api/cooperations/${cooperationId}`)
    check(
      'чужая связка отдаёт 404',
      foreignCooperation.status === 404,
      `код ${foreignCooperation.body.error?.code}`,
    )

    // Аналитика и рекомендации представителю недоступны.
    const repAnalytics = await call('GET', '/api/analytics/overview')
    check('аналитика недоступна', repAnalytics.status === 403, `код ${repAnalytics.body.error?.code}`)

    const repRating = await call('GET', '/api/analytics/programs')
    check('рейтинг недоступен', repRating.status === 403)

    const repRecommendations = await call('GET', '/api/recommendations')
    check('рекомендации недоступны', repRecommendations.status === 403)

    const repGaps = await call('GET', '/api/skills/gaps')
    check('аналитика навыков недоступна', repGaps.status === 403)

    // Запись в основной системе представителю запрещена.
    const repWrite = await call('POST', '/api/universities', {
      name: 'Попытка создать вуз представителем',
      city: 'Москва',
      region: 'Москва',
    })
    check('создание вуза запрещено', repWrite.status === 403, `код ${repWrite.body.error?.code}`)

    // Внутренние комментарии к этапам скрыты.
    const repCooperations = await call<Array<{ id: string }>>('GET', '/api/cooperations?pageSize=5')
    const ownCooperationId = repCooperations.body.data?.[0]?.id
    if (ownCooperationId) {
      const ownCooperation = await call<{
        notes: string | null
        stages: Array<{ comment: string | null; blockingReason: string | null; result: string | null }>
      }>('GET', `/api/cooperations/${ownCooperationId}`)
      check('представитель открывает свою связку', ownCooperation.status === 200)
      check('внутренние заметки по связке скрыты', ownCooperation.body.data?.notes === null)
      check(
        'внутренние комментарии к этапам скрыты',
        (ownCooperation.body.data?.stages ?? []).every((stage) => stage.comment === null),
      )
      check(
        'причины блокировок скрыты',
        (ownCooperation.body.data?.stages ?? []).every((stage) => stage.blockingReason === null),
      )
      check(
        'результаты этапов вузу видны',
        (ownCooperation.body.data?.stages ?? []).some((stage) => stage.result !== null),
      )
    }

    // Подтверждение получения материалов.
    const repMaterials = await call<Array<{ taskId: string; isConfirmed: boolean }>>(
      'GET',
      '/api/portal/materials',
    )
    check('материалы к подтверждению получены', repMaterials.status === 200, `${repMaterials.body.data?.length ?? 0} позиций`)

    // Берётся первый материал независимо от того, подтверждён он уже или нет:
    // подтверждение идемпотентно, и сценарий не должен молча пропускать проверки
    // на повторном прогоне без пересева данных.
    const material = (repMaterials.body.data ?? [])[0]
    check('есть хотя бы один переданный материал', Boolean(material))

    if (material) {
      const confirmed = await call<
        Array<{ taskId: string; isConfirmed: boolean; confirmedAt: string | null }>
      >('POST', `/api/portal/materials/${material.taskId}/confirm`, {
        comment: 'Материалы получены',
      })
      check('получение материалов подтверждается', confirmed.status === 200)
      const updatedItem = (confirmed.body.data ?? []).find(
        (item) => item.taskId === material.taskId,
      )
      check('отметка подтверждения сохранена', updatedItem?.isConfirmed === true)
      check('время подтверждения зафиксировано', Boolean(updatedItem?.confirmedAt))

      // Повторное подтверждение не должно ломаться и не должно сбрасывать отметку.
      const again = await call<Array<{ taskId: string; isConfirmed: boolean }>>(
        'POST',
        `/api/portal/materials/${material.taskId}/confirm`,
      )
      check('повторное подтверждение безопасно', again.status === 200)
      check(
        'отметка не сбрасывается повторным подтверждением',
        (again.body.data ?? []).find((item) => item.taskId === material.taskId)?.isConfirmed ===
          true,
      )

      const foreignTask = await call('POST', `/api/portal/materials/${stage1.tasks[0]?.id}/confirm`)
      check(
        'подтверждение задачи не из этапа материалов отклоняется',
        foreignTask.status === 404,
        `код ${foreignTask.body.error?.code}`,
      )
    }

    // Показатели набора: вуз вносит обучающихся и группы.
    const repProgram = portal.body.data?.programs[0]
    if (repProgram) {
      const metrics = await call<{ studentCount: number | null; groupCount: number | null }>(
        'PATCH',
        `/api/portal/programs/${repProgram.id}/metrics`,
        { studentCount: 137, groupCount: 6 },
      )
      check('вуз вносит численность обучающихся', metrics.body.data?.studentCount === 137)
      check('вуз вносит количество групп', metrics.body.data?.groupCount === 6)

      const forbiddenField = await call('PATCH', `/api/portal/programs/${repProgram.id}/metrics`, {
        applicationCount: 999,
      })
      check(
        'заявки напрямую через кабинет не правятся',
        forbiddenField.status === 422,
        `код ${forbiddenField.body.error?.code}`,
      )

      // Заявки на обучение: applicationCount пересчитывается по ним.
      const before = await call<{ programs: Array<{ id: string; applicationCount: number | null }> }>(
        'GET',
        '/api/portal/overview',
      )
      const countBefore =
        before.body.data?.programs.find((item) => item.id === repProgram.id)?.applicationCount ?? 0

      const application = await call<{ id: string; quantity: number }>(
        'POST',
        '/api/portal/applications',
        { programId: repProgram.id, quantity: 25, comment: 'Заявки весеннего набора' },
      )
      check('заявка подаётся', application.status === 201, `статус ${application.status}`)
      check('количество заявок сохранено', application.body.data?.quantity === 25)

      const after = await call<{ programs: Array<{ id: string; applicationCount: number | null }> }>(
        'GET',
        '/api/portal/overview',
      )
      const countAfter =
        after.body.data?.programs.find((item) => item.id === repProgram.id)?.applicationCount ?? 0
      check(
        'applicationCount пересчитан по заявкам',
        countAfter === countBefore + 25,
        `было ${countBefore}, стало ${countAfter}`,
      )

      const foreignApplication = await call('POST', '/api/portal/applications', {
        programId,
        quantity: 5,
      })
      check(
        'заявка на чужую программу отклоняется',
        foreignApplication.status === 422,
        `код ${foreignApplication.body.error?.code}`,
      )

      const applications = await call<unknown[]>('GET', '/api/portal/applications')
      check('список заявок доступен', applications.status === 200, `${applications.body.data?.length ?? 0} заявок`)
    }

    // Возвращаемся к сотруднику.
    actAs(null)
  }

  // ── 19. Интеграции и источники данных ──────────────────────────────────────
  step('19. Интеграционный слой и источники данных')
  const integrations = await call<{
    marketDataProvider: string
    integrations: Array<{ key: string; enabled: boolean; configured: boolean; reason: string | null }>
  }>('GET', '/api/integrations/status')
  check('GET /api/integrations/status отвечает 200', integrations.status === 200)
  check(
    'активный источник рыночных данных указан',
    Boolean(integrations.body.data?.marketDataProvider),
    integrations.body.data?.marketDataProvider,
  )

  const lmsStatus = integrations.body.data?.integrations.find((item) => item.key === 'lms')
  const siteStatus = integrations.body.data?.integrations.find((item) => item.key === 'site')
  check('LMS по умолчанию выключена', lmsStatus?.enabled === false)
  check('у выключенной LMS указана причина', Boolean(lmsStatus?.reason), lmsStatus?.reason ?? '')
  check('интеграция с сайтом по умолчанию выключена', siteStatus?.enabled === false)

  const sync = await call<{
    provider: string
    imported: number
    updated: number
    unknownSkills: string[]
    isMock: boolean
  }>('POST', '/api/data-sources/sync', { period: '2026-Q1' })
  check('POST /api/data-sources/sync отвечает 200', sync.status === 200, `статус ${sync.status}`)
  check(
    'рыночные данные загружены источником',
    (sync.body.data?.imported ?? 0) + (sync.body.data?.updated ?? 0) > 0,
    `создано ${sync.body.data?.imported}, обновлено ${sync.body.data?.updated}`,
  )
  check('демонстрационный источник помечен', sync.body.data?.isMock === true)
  check(
    'неизвестные навыки не выдумываются, а перечисляются',
    Array.isArray(sync.body.data?.unknownSkills),
    `${sync.body.data?.unknownSkills.length ?? 0} неизвестных`,
  )

  // Повторная загрузка не должна плодить дубликаты.
  const resync = await call<{ imported: number; updated: number }>(
    'POST',
    '/api/data-sources/sync',
    { period: '2026-Q1' },
  )
  check(
    'повторная загрузка обновляет, а не дублирует',
    resync.body.data?.imported === 0,
    `создано заново: ${resync.body.data?.imported}`,
  )

  const emptyBodySync = await call('POST', '/api/data-sources/sync')
  check('синхронизация работает без тела запроса', emptyBodySync.status === 200)

  const sources = await call<Array<{ name: string; isMock: boolean; demandRecords: number }>>(
    'GET',
    '/api/data-sources',
  )
  check('GET /api/data-sources отвечает 200', sources.status === 200)
  check('источники получены', (sources.body.data?.length ?? 0) > 0, `${sources.body.data?.length ?? 0} источников`)
  check(
    'у источника указано количество показателей',
    (sources.body.data ?? []).some((source) => source.demandRecords > 0),
  )

  // После загрузки аналитика навыков продолжает работать.
  const demandAfterSync = await call<unknown[]>('GET', '/api/skills/demand?period=2026-Q1')
  check('спрос по навыкам доступен после загрузки', demandAfterSync.status === 200)
  check('данные на месте', (demandAfterSync.body.data?.length ?? 0) > 0)

  // ── 20. Журнал и лента событий ─────────────────────────────────────────────
  step('20. Журнал действий и лента событий вуза')

  // Берём вуз, по которому реально шла работа: у вуза без связок в ленте будет
  // один вид событий, и проверка разнообразия зависела бы от порядка сортировки.
  const activeCooperations = await call<Array<{ universityId: string }>>(
    'GET',
    '/api/cooperations?pageSize=50',
  )
  const eventsUniversityId =
    activeCooperations.body.data?.[0]?.universityId ?? ownUniversity.id

  const events = await call<
    Array<{ kind: string; title: string; occurredAt: string; author: unknown }>
  >('GET', `/api/universities/${eventsUniversityId}/events?limit=30`)
  check('GET /api/universities/:id/events отвечает 200', events.status === 200)
  const feed = events.body.data ?? []
  check('лента событий заполнена', feed.length > 0, `${feed.length} событий`)
  check(
    'события отсортированы от свежих к старым',
    feed.every((item, index) => index === 0 || feed[index - 1]!.occurredAt >= item.occurredAt),
  )
  check(
    'в ленте несколько видов событий',
    new Set(feed.map((item) => item.kind)).size > 1,
    [...new Set(feed.map((item) => item.kind))].join(', '),
  )
  check(
    'у события есть читаемый заголовок',
    feed.every((item) => item.title.length > 0 && !item.title.includes('_')),
  )

  const foreignEvents = await call('GET', '/api/universities/no-such-id/events')
  check('лента несуществующего вуза отдаёт 404', foreignEvents.status === 404)

  // Журнал действий — только администратору.
  const auditAsManager = await call('GET', '/api/audit')
  check(
    'журнал закрыт для менеджера',
    auditAsManager.status === 403,
    `код ${auditAsManager.body.error?.code}`,
  )

  const admins = await call<Array<{ id: string }>>('GET', '/api/users?role=ADMIN')
  const adminId = admins.body.data?.[0]?.id
  check('администратор найден в справочнике', Boolean(adminId))

  if (adminId) {
    actAs(adminId)
    const audit = await call<Array<{ action: string; objectType: string; user: unknown }>>(
      'GET',
      '/api/audit?pageSize=50',
    )
    check('GET /api/audit отвечает 200 администратору', audit.status === 200)
    check('журнал заполнен', (audit.body.data?.length ?? 0) > 0, `${audit.body.data?.length ?? 0} записей`)
    check(
      'у записи журнала есть действие и автор',
      (audit.body.data ?? []).every((row) => row.action.length > 0),
    )

    const filtered = await call<Array<{ action: string }>>(
      'GET',
      '/api/audit?action=stage.status.change',
    )
    check(
      'фильтр журнала по действию работает',
      filtered.status === 200 &&
        (filtered.body.data ?? []).every((row) => row.action === 'stage.status.change'),
      `${filtered.body.data?.length ?? 0} записей`,
    )
    actAs(null)
  }

  // ── 21. Групповая операция по IT-продукту ──────────────────────────────────
  step('21. Выпуск новой версии продукта: групповая операция')

  // Сценарий сам готовит предусловие — в отдельной связке, чтобы не менять ту,
  // на которой держатся шаги выше, и не зависеть от прошлых запусков. Связке нужен
  // тот же продукт, а вторая незакрытая связка «вуз + программа + продукт» запрещена
  // (решение 80) — поэтому она заводится на отдельной программе того же вуза.
  // Связка проводится до этапа 12 по правилам: обычные этапы отменяются с основанием,
  // контрольные точки 6, 7 и 11 завершаются с чек-листом и результатом — иначе
  // шлагбаум (решение 78) не пустит к этапу 12.
  type ReleaseStage = {
    id: string
    stageNumber: number
    status: string
    tasks: Array<{ id: string; isRequired: boolean; isDone: boolean }>
  }
  const releaseProgram = await call<Identified>('POST', '/api/programs', {
    universityId,
    name: `Проверочная программа выпуска версии ${suffix}`,
    level: 'BACHELOR',
  })
  check(
    'отдельная программа для выпуска версии создана',
    releaseProgram.status === 201,
    `статус ${releaseProgram.status}`,
  )
  const releaseCooperation = await call<{ id: string; stages: ReleaseStage[] }>(
    'POST',
    '/api/cooperations',
    {
      universityId,
      programId: releaseProgram.body.data?.id,
      productId,
      responsibleId: managerId,
      goal: 'Связка сквозного сценария для выпуска версии продукта',
    },
  )
  check(
    'связка для выпуска версии создана',
    releaseCooperation.status === 201,
    `статус ${releaseCooperation.status} ${releaseCooperation.body.error?.message ?? ''}`,
  )
  const releaseCooperationId = releaseCooperation.body.data?.id
  const releaseStages = [...(releaseCooperation.body.data?.stages ?? [])].sort(
    (left, right) => left.stageNumber - right.stageNumber,
  )
  for (const stage of releaseStages.filter((item) => item.stageNumber < 12)) {
    if (CONTROL_POINT_STAGES.includes(stage.stageNumber)) {
      await call('PATCH', `/api/workflow/stages/${stage.id}`, { status: 'IN_PROGRESS' })
      for (const task of stage.tasks.filter((item) => item.isRequired && !item.isDone)) {
        await call('PATCH', `/api/workflow/tasks/${task.id}`, { isDone: true })
      }
      await call('PATCH', `/api/workflow/stages/${stage.id}`, {
        status: 'COMPLETED',
        result: 'Пройдено сквозным сценарием',
      })
    } else {
      await call('PATCH', `/api/workflow/stages/${stage.id}`, {
        status: 'CANCELLED',
        comment: 'Не требуется для проверки выпуска версии',
      })
    }
  }
  const stage12 = releaseStages.find((stage) => stage.stageNumber === 12)
  check('этап 12 найден в связке для выпуска версии', Boolean(stage12))

  if (stage12 && productId) {
    await call('PATCH', `/api/workflow/stages/${stage12.id}`, { status: 'IN_PROGRESS' })
    for (const task of stage12.tasks.filter((item) => item.isRequired && !item.isDone)) {
      await call('PATCH', `/api/workflow/tasks/${task.id}`, { isDone: true })
    }
    const closed = await call<{ status: string }>('PATCH', `/api/workflow/stages/${stage12.id}`, {
      status: 'COMPLETED',
      result: 'Материалы переданы в актуальной версии',
    })
    check('этап 12 закрыт для подготовки проверки', closed.body.data?.status === 'COMPLETED')

    const productBefore = await call<{ version: string | null; name: string }>(
      'GET',
      `/api/products/${productId}`,
    )
    const nextVersion = `smoke-${suffix}`

    const preview = await call<{
      currentVersion: string | null
      nextVersion: string
      targets: Array<{ effect: string; reason: string; cooperationId: string }>
      affectedCooperations: number
      reopenedStages: number
    }>('GET', `/api/products/${productId}/release?version=${encodeURIComponent(nextVersion)}`)
    check('предпросмотр групповой операции отвечает 200', preview.status === 200)
    check(
      'предпросмотр показывает затронутые связки',
      (preview.body.data?.affectedCooperations ?? 0) > 0,
      `${preview.body.data?.affectedCooperations} связок`,
    )
    check(
      'у каждой связки объяснено, что произойдёт',
      (preview.body.data?.targets ?? []).every((target) => target.reason.length > 0),
    )
    check(
      'предпросмотр находит закрытый этап для переоткрытия',
      (preview.body.data?.reopenedStages ?? 0) > 0,
      `${preview.body.data?.reopenedStages} этапов`,
    )
    check(
      'собственная связка попала в план с переоткрытием',
      (preview.body.data?.targets ?? []).some(
        (target) =>
          target.cooperationId === releaseCooperationId && target.effect === 'stage-reopened',
      ),
    )

    const versionAfterPreview = await call<{ version: string | null }>(
      'GET',
      `/api/products/${productId}`,
    )
    check(
      'предпросмотр ничего не меняет',
      versionAfterPreview.body.data?.version === productBefore.body.data?.version,
    )

    const release = await call<{
      nextVersion: string
      affectedCooperations: number
      reopenedStages: number
    }>('POST', `/api/products/${productId}/release`, {
      version: nextVersion,
      comment: 'Проверочный выпуск сквозного сценария',
    })
    check('POST .../release отвечает 200', release.status === 200, `статус ${release.status}`)
    check(
      'операция затронула связки',
      (release.body.data?.affectedCooperations ?? 0) > 0,
      `${release.body.data?.affectedCooperations} связок, переоткрыто ${release.body.data?.reopenedStages}`,
    )

    const productAfter = await call<{ version: string | null }>('GET', `/api/products/${productId}`)
    check('новая версия сохранена', productAfter.body.data?.version === nextVersion)

    const reopened = await call<{
      stages: Array<{
        stageNumber: number
        status: string
        tasks: Array<{ title: string; isRequired: boolean; isDone: boolean }>
      }>
    }>('GET', `/api/cooperations/${releaseCooperationId}`)
    const stage12After = reopened.body.data?.stages.find((stage) => stage.stageNumber === 12)
    check('закрытый этап переоткрыт', stage12After?.status === 'IN_PROGRESS', `статус ${stage12After?.status}`)

    const newTask = stage12After?.tasks.find((task) => task.title.includes(nextVersion))
    check('в затронутую связку поставлена задача', Boolean(newTask), newTask?.title)
    check(
      'задача обязательна и не закрыта',
      newTask?.isRequired === true && newTask.isDone === false,
    )

    const history = await call<Array<{ toStatus: string; comment: string | null }>>(
      'GET',
      `/api/workflow/stages/${stage12.id}/history`,
    )
    check(
      'переоткрытие попало в историю с причиной',
      (history.body.data ?? []).some(
        (entry) => entry.toStatus === 'IN_PROGRESS' && (entry.comment ?? '').includes('устарели'),
      ),
    )

    const sameVersion = await call('POST', `/api/products/${productId}/release`, {
      version: nextVersion,
    })
    check(
      'повторный выпуск той же версии отклоняется',
      sameVersion.status === 409,
      `код ${sameVersion.body.error?.code}`,
    )

    const emptyVersion = await call('POST', `/api/products/${productId}/release`, { version: '' })
    check('пустая версия отклоняется', emptyVersion.status === 422)
  }

  // ── 21a. Пакет документов из шаблонов ──────────────────────────────────────
  step('21a. Сборка пакета документов из шаблонов')

  const templates = await call<{
    templates: Array<{ key: string; inDefaultPackage: boolean; placeholders: string[] }>
    placeholders: string[]
  }>('GET', '/api/document-templates')
  check('GET /api/document-templates отвечает 200', templates.status === 200)
  check(
    'шаблоны получены',
    (templates.body.data?.templates.length ?? 0) > 0,
    `${templates.body.data?.templates.length ?? 0} шаблонов`,
  )
  check(
    'у шаблонов перечислены подстановки',
    (templates.body.data?.templates ?? []).every((item) => item.placeholders.length > 0),
  )
  check('список доступных реквизитов отдан', (templates.body.data?.placeholders.length ?? 0) > 0)

  const packageResult = await call<{
    created: Array<{
      templateKey: string
      missing: string[]
      document: { id: string; title: string; content: string | null; templateKey: string | null }
    }>
    skipped: Array<{ templateKey: string; templateName: string; reason: string }>
    missingFields: string[]
    missingFieldLabels: string[]
  }>('POST', `/api/cooperations/${cooperationId}/documents/generate`)
  check('POST .../documents/generate отвечает 200', packageResult.status === 200, `статус ${packageResult.status}`)

  const packageDocuments = packageResult.body.data?.created ?? []
  check('пакет собран', packageDocuments.length > 0, `${packageDocuments.length} документов`)
  check(
    'у каждого документа есть текст',
    packageDocuments.every((item) => (item.document.content ?? '').length > 0),
  )
  check(
    'реквизиты подставлены в текст',
    packageDocuments.some((item) => (item.document.content ?? '').includes('Проверочный университет')),
  )
  check(
    'заголовок тоже собран из шаблона',
    packageDocuments.every((item) => !item.document.title.includes('{{')),
  )
  check(
    'в тексте не осталось неподставленных меток',
    packageDocuments.every((item) => !(item.document.content ?? '').includes('{{')),
  )
  check(
    'документ помнит свой шаблон',
    packageDocuments.every((item) => item.document.templateKey === item.templateKey),
  )

  // Повторная сборка не должна плодить дубликаты.
  const secondPackage = await call<{
    created: unknown[]
    skipped: Array<{ templateKey: string; reason: string }>
  }>('POST', `/api/cooperations/${cooperationId}/documents/generate`)
  check('повторная сборка не создаёт дубликаты', (secondPackage.body.data?.created.length ?? 0) === 0)
  check(
    'пропущенные шаблоны объяснены',
    (secondPackage.body.data?.skipped ?? []).every((item) => item.reason.length > 0),
    `${secondPackage.body.data?.skipped.length ?? 0} пропущено`,
  )
  // В шаге 16 договор заведён вручную и выпущен новой версией. Пакет не должен
  // добавить к нему второй договор из шаблона.
  const agreementSkip = (packageResult.body.data?.skipped ?? []).find(
    (item) => item.templateKey === 'agreement',
  )
  check(
    'пакет не добавляет второй договор к заведённому вручную',
    Boolean(agreementSkip?.reason.startsWith('уже есть:')) &&
      !packageDocuments.some((item) => item.templateKey === 'agreement'),
    agreementSkip?.reason,
  )
  check(
    'пропущенный шаблон назван по-русски',
    (packageResult.body.data?.skipped ?? []).every((item) => /[а-яА-Я]/.test(item.templateName)),
  )
  check(
    'недостающие реквизиты названы по-русски',
    (packageResult.body.data?.missingFieldLabels ?? []).length ===
      (packageResult.body.data?.missingFields ?? []).length &&
      (packageResult.body.data?.missingFieldLabels ?? []).every((label) => !label.includes('.')),
    (packageResult.body.data?.missingFieldLabels ?? []).join(', '),
  )
  check(
    'в тексте документов нет служебных пометок',
    packageDocuments.every((item) => !/TEMP|болванк/i.test(item.document.content ?? '')),
  )

  // Отдельный шаблон вне пакета по умолчанию.
  const extraTemplate = (templates.body.data?.templates ?? []).find(
    (item) => !item.inDefaultPackage,
  )
  if (extraTemplate) {
    const single = await call<{ created: Array<{ templateKey: string }> }>(
      'POST',
      `/api/cooperations/${cooperationId}/documents/generate`,
      { templateKeys: [extraTemplate.key] },
    )
    check(
      'можно собрать отдельный шаблон вне пакета',
      single.body.data?.created[0]?.templateKey === extraTemplate.key,
    )
  }

  const unknownTemplate = await call(
    'POST',
    `/api/cooperations/${cooperationId}/documents/generate`,
    { templateKeys: ['no-such-template'] },
  )
  check('несуществующий шаблон отклоняется', unknownTemplate.status === 422)

  // Собранный документ уходит на согласование без ссылки на файл: текст и есть документ.
  const generatedDocumentId = packageDocuments[0]?.document.id
  if (generatedDocumentId) {
    const toReview = await call<{ status: string }>(
      'PATCH',
      `/api/documents/${generatedDocumentId}/status`,
      { status: 'REVIEW' },
    )
    check(
      'собранный документ отправляется на согласование без ссылки на файл',
      toReview.body.data?.status === 'REVIEW',
      `статус ${toReview.status}`,
    )
  }

  // ── 22. Настоящая аутентификация ───────────────────────────────────────────
  step('22. Вход по паролю: NextAuth.js и bcrypt')

  /**
   * Пароль демо-пользователей.
   *
   * Читается из окружения ровно так же, как его задаёт `prisma/seed.ts`.
   * Зашитая строка работала только против базы, засеянной по умолчанию:
   * на копии стенда, где пароль свой, проверки входа падали так, будто
   * сломалась авторизация, — и следующий человек искал бы несуществующую ошибку.
   */
  const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD?.trim() || 'skilllink'

  const csrf = await call<Record<string, never>>('GET', '/api/auth/csrf')
  check('GET /api/auth/csrf отвечает 200', csrf.status === 200)
  const csrfToken = (csrf.body as unknown as { csrfToken?: string } | null)?.csrfToken
  check('csrf-токен получен', Boolean(csrfToken))

  const providers = await call('GET', '/api/auth/providers')
  check('NextAuth отдаёт список провайдеров', providers.status === 200)

  if (csrfToken) {
    // Неверный пароль не должен создавать сессию.
    clearSession()
    const badCsrf = await call<Record<string, never>>('GET', '/api/auth/csrf')
    const badToken = (badCsrf.body as unknown as { csrfToken?: string } | null)?.csrfToken ?? ''
    await postForm('/api/auth/callback/credentials', {
      csrfToken: badToken,
      email: 'analyst@skilllink.demo',
      password: 'неверный-пароль',
    })
    const afterBad = await call('GET', '/api/auth/session')
    check('неверный пароль не создаёт сессию', !sessionUserOf(afterBad)?.id)

    // Верный пароль создаёт сессию под нужной ролью.
    clearSession()
    const goodCsrf = await call<Record<string, never>>('GET', '/api/auth/csrf')
    const goodToken = (goodCsrf.body as unknown as { csrfToken?: string } | null)?.csrfToken ?? ''
    const loginStatus = await postForm('/api/auth/callback/credentials', {
      csrfToken: goodToken,
      email: 'analyst@skilllink.demo',
      password: DEMO_PASSWORD,
    })
    check('вход по паролю принят', loginStatus < 400, `статус ${loginStatus}`)

    const session = await call('GET', '/api/auth/session')
    const sessionUser = sessionUserOf(session)
    check('сессия создана', Boolean(sessionUser?.id))
    check('роль пришла в сессию', sessionUser?.role === 'ANALYST', `роль ${sessionUser?.role}`)

    // Сессия важнее демо-cookie: подменить пользователя подстановкой cookie нельзя.
    actAs(adminId ?? null)
    const meWithSession = await call<{ role: string; permissions: { canWrite: boolean } }>(
      'GET',
      '/api/me',
    )
    check(
      'сессия имеет приоритет над демо-cookie',
      meWithSession.body.data?.role === 'ANALYST',
      `роль ${meWithSession.body.data?.role}`,
    )
    check('права соответствуют роли из сессии', meWithSession.body.data?.permissions.canWrite === false)
    actAs(null)

    // Права аналитика действуют и на обычных маршрутах.
    const analystWrite = await call('POST', '/api/universities', {
      name: 'Попытка создать вуз аналитиком',
      city: 'Москва',
      region: 'Москва',
    })
    check('аналитик не может создавать записи', analystWrite.status === 403)

    const analystRead = await call('GET', '/api/universities?pageSize=1')
    check('аналитик читает данные', analystRead.status === 200)

    // Выход завершает сессию.
    const signOutCsrf = await call<Record<string, never>>('GET', '/api/auth/csrf')
    const signOutToken =
      (signOutCsrf.body as unknown as { csrfToken?: string } | null)?.csrfToken ?? ''
    await postForm('/api/auth/signout', { csrfToken: signOutToken })
    const afterSignOut = await call('GET', '/api/auth/session')
    check('выход завершает сессию', !sessionUserOf(afterSignOut)?.id)
    clearSession()
  }

  // ── 23. Спецификация OpenAPI ───────────────────────────────────────────────
  step('23. Спецификация OpenAPI')

  const spec = await call<Record<string, never>>('GET', '/api/openapi.json')
  check('GET /api/openapi.json отвечает 200', spec.status === 200)

  const document = spec.body as unknown as {
    openapi?: string
    paths?: Record<string, Record<string, { summary?: string; responses?: Record<string, unknown> }>>
    tags?: unknown[]
  }
  check('это OpenAPI 3.1', document.openapi === '3.1.0', document.openapi)
  check(
    'описаны все пути',
    Object.keys(document.paths ?? {}).length > 40,
    `${Object.keys(document.paths ?? {}).length} путей`,
  )
  check('операции сгруппированы по разделам', (document.tags?.length ?? 0) > 5)

  const operations = Object.values(document.paths ?? {}).flatMap((methods) =>
    Object.values(methods),
  )
  check(
    'у каждой операции есть краткое описание',
    operations.every((operation) => (operation.summary ?? '').length > 0),
    `${operations.length} операций`,
  )
  check(
    'у каждой операции описаны ответы',
    operations.every((operation) => Object.keys(operation.responses ?? {}).length > 0),
  )

  // Спецификация должна описывать живой сервер, а не расходиться с ним.
  const gapsSpec = document.paths?.['/api/skills/gaps']?.get
  check('описан эндпоинт дефицита навыков', Boolean(gapsSpec))

  // ── 24. Выгрузка реестров ──────────────────────────────────────────────────
  step('24. Выгрузка реестров в CSV')

  for (const dataset of ['universities', 'programs', 'cooperations', 'skill-gaps']) {
    const file = await fetchRaw(`/api/export?dataset=${dataset}&limit=50`)
    check(`выгрузка ${dataset} отвечает 200`, file.status === 200, `статус ${file.status}`)
    check(
      `${dataset}: тип содержимого — CSV`,
      (file.headers.get('content-type') ?? '').includes('text/csv'),
    )
    check(
      `${dataset}: файл предлагается к скачиванию`,
      (file.headers.get('content-disposition') ?? '').includes('.csv'),
    )
    check(`${dataset}: файл начинается с BOM для Excel`, hasUtf8Bom(file.bytes))
    check(
      `${dataset}: есть строка заголовков`,
      (file.text.split('\r\n')[0] ?? '').includes(';'),
    )
  }

  // Цикл «выгрузил → поправил → загрузил обратно» должен работать без переименований.
  const exported = await fetchRaw('/api/export?dataset=universities&limit=5')
  const lines = exported.text.replace(/^\ufeff/, '').split('\r\n').filter((line) => line !== '')
  const header = lines[0] ?? ''
  const importedName = `Загруженный университет ${suffix}`
  const columns = header.split(';')
  const cells = columns.map((column) =>
    column === 'Название'
      ? importedName
      : column === 'Город'
        ? 'Тверь'
        : column === 'Регион'
          ? 'Тверская область'
          : column === 'Студентов'
            ? '7 500'
            : '',
  )
  const csvToImport = `\ufeff${header}\r\n${cells.join(';')}\r\n`

  const preview = await postCsv('/api/import?dataset=universities', csvToImport)
  check('предпросмотр загрузки отвечает 200', preview.status === 200, `статус ${preview.status}`)
  const previewBody = preview.body as unknown as {
    data?: { mode: string; created: number; rows: Array<{ outcome: string }> }
  }
  check('предпросмотр помечен как предпросмотр', previewBody.data?.mode === 'preview')
  check('предпросмотр видит новую строку', previewBody.data?.created === 1)

  const notYet = await call<unknown[]>(
    'GET',
    `/api/universities?q=${encodeURIComponent(importedName)}`,
  )
  check('предпросмотр ничего не записал', (notYet.body.data?.length ?? 0) === 0)

  const applied = await postCsv('/api/import?dataset=universities&mode=apply', csvToImport)
  const appliedBody = applied.body as unknown as { data?: { created: number; errors: number } }
  check('загрузка применена', applied.status === 200 && appliedBody.data?.created === 1)
  check('ошибок при загрузке нет', appliedBody.data?.errors === 0)

  const nowThere = await call<Array<{ name: string }>>(
    'GET',
    `/api/universities?q=${encodeURIComponent(importedName)}`,
  )
  check('загруженный вуз появился', (nowThere.body.data?.length ?? 0) === 1)

  const again = await postCsv('/api/import?dataset=universities&mode=apply', csvToImport)
  const againBody = again.body as unknown as { data?: { created: number; updated: number } }
  check('повторная загрузка не плодит двойников', againBody.data?.created === 0)

  const stillOne = await call<unknown[]>(
    'GET',
    `/api/universities?q=${encodeURIComponent(importedName)}`,
  )
  check('вуз по-прежнему один', (stillOne.body.data?.length ?? 0) === 1)

  const missingColumn = await postCsv('/api/import?dataset=universities', '\ufeffНазвание\r\nВуз\r\n')
  check('файл без обязательных колонок отклоняется', missingColumn.status === 422)

  const badDataset = await fetchRaw('/api/export?dataset=everything')
  check('неизвестный раздел выгрузки отклоняется', badDataset.status === 422)

  const hugeLimit = await fetchRaw('/api/export?dataset=universities&limit=999999')
  check('слишком большая выгрузка отклоняется', hugeLimit.status === 422)

  // ── Рейтинг вуза (пункт 7.2 ТЗ) ────────────────────────────────────────────
  step('Рейтинг вуза и фильтрация по нему')

  // Решение Артура, пункт 11: рейтинг — обычное поле реестра, приходит по умолчанию.
  const r_byDefault = await call<{ rating: unknown }[]>('GET', '/api/universities?pageSize=3')
  check(
    'рейтинг приходит по умолчанию, без параметров',
    r_byDefault.body.data?.every((row) => row.rating !== null) === true,
  )

  const r_noRating = await call<{ rating: unknown }[]>(
    'GET',
    '/api/universities?pageSize=3&withRating=false',
  )
  check(
    'withRating=false отключает расчёт',
    r_noRating.body.data?.every((row) => row.rating === null) === true,
  )

  type RatedRow = {
    id: string
    name: string
    rating: {
      score: number | null
      basis: string
      explanation: string
      programCount: number
      ratedProgramCount: number
      topProgram: { programId: string; name: string; score: number } | null
    }
  }

  const r_rated = await call<RatedRow[]>('GET', '/api/universities?pageSize=100&withRating=true')
  const r_ratedRows = r_rated.body.data ?? []
  check('withRating=true возвращает рейтинг у каждой строки', r_ratedRows.every((row) => row.rating !== null))
  check(
    'балл не выходит за шкалу 0..100',
    r_ratedRows.every((row) => row.rating.score === null || (row.rating.score >= 0 && row.rating.score <= 100)),
  )
  check(
    'у каждого балла есть человекочитаемое пояснение',
    r_ratedRows.every((row) => row.rating.explanation.length > 10),
  )
  check(
    'вуз без заполненных показателей получает null, а не ноль',
    r_ratedRows.every((row) => row.rating.ratedProgramCount > 0 || row.rating.score === null),
  )
  check(
    'учтённых программ не больше, чем всего',
    r_ratedRows.every((row) => row.rating.ratedProgramCount <= row.rating.programCount),
  )
  check(
    'у посчитанного балла раскрыта сильнейшая программа',
    r_ratedRows.every((row) => row.rating.score === null || row.rating.topProgram !== null),
  )

  const r_desc = await call<RatedRow[]>('GET', '/api/universities?pageSize=100&sort=-rating')
  const r_descScores = (r_desc.body.data ?? []).map((row) => row.rating.score)
  const r_descNumbers = r_descScores.filter((score): score is number => score !== null)
  check(
    'сортировка по убыванию рейтинга действительно убывающая',
    r_descNumbers.every((score, index) => index === 0 || r_descNumbers[index - 1]! >= score),
  )
  check(
    'вузы без балла уходят в конец списка',
    r_descScores.findIndex((score) => score === null) === -1 ||
      r_descScores.findIndex((score) => score === null) >= r_descNumbers.length,
  )

  const r_asc = await call<RatedRow[]>('GET', '/api/universities?pageSize=100&sort=rating')
  const r_ascNumbers = (r_asc.body.data ?? [])
    .map((row) => row.rating.score)
    .filter((score): score is number => score !== null)
  check(
    'сортировка по возрастанию рейтинга действительно возрастающая',
    r_ascNumbers.every((score, index) => index === 0 || r_ascNumbers[index - 1]! <= score),
  )

  const r_threshold = r_descNumbers.length > 0 ? Math.floor(r_descNumbers[r_descNumbers.length - 1]!) : 0
  const r_filtered = await call<RatedRow[]>(
    'GET',
    `/api/universities?pageSize=100&minRating=${r_threshold}&withRating=true`,
  )
  check(
    'фильтр minRating не пропускает вузы ниже порога (пункт 7.2 ТЗ)',
    (r_filtered.body.data ?? []).every((row) => row.rating.score !== null && row.rating.score >= r_threshold),
  )
  check(
    'фильтр по рейтингу отсекает вузы без данных',
    (r_filtered.body.data ?? []).every((row) => row.rating.score !== null),
  )

  const r_impossible = await call<RatedRow[]>('GET', '/api/universities?minRating=99&maxRating=1')
  check(
    'встречный диапазон рейтинга даёт пустой список, а не ошибку',
    r_impossible.status === 200 && (r_impossible.body.data?.length ?? 0) === 0,
  )

  const r_outOfScale = await fetchRaw('/api/universities?minRating=200')
  check('рейтинг вне шкалы 0..100 отклоняется', r_outOfScale.status === 422)

  const r_ratedCard = await call<RatedRow>('GET', `/api/universities/${r_ratedRows[0]!.id}`)
  check('карточка вуза отдаёт рейтинг без дополнительных параметров', r_ratedCard.body.data?.rating != null)

  // ── Итог ───────────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}Итог${RESET}`)
  console.log(`  ${GREEN}Успешно: ${passed}${RESET}`)
  if (failed > 0) {
    console.log(`  ${RED}Провалено: ${failed}${RESET}`)
    for (const name of failures) console.log(`    ${RED}- ${name}${RESET}`)
    process.exitCode = 1
  } else {
    console.log(`  ${GREEN}Сквозной сценарий пройден полностью.${RESET}`)
  }
}

main().catch((error) => {
  console.error(`${RED}Сценарий упал:${RESET}`, error)
  process.exitCode = 1
})
