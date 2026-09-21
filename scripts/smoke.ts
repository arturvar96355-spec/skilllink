/**
 * Сквозной сценарий SkillLink: frontend → API → backend → database.
 * Повторяет демонстрационный сценарий из раздела 18 ТЗ и проверки из раздела 17.
 *
 * Запуск: npm run dev, затем в другом окне npm run smoke
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

interface ApiResult<T> {
  status: number
  body: {
    data?: T
    meta?: Record<string, unknown>
    error?: { code: string; message: string; details?: unknown }
  }
}

/** Пользователь, от имени которого идут запросы: mock-авторизация через cookie (решение 9). */
let currentUserId: string | null = null

function actAs(userId: string | null): void {
  currentUserId = userId
}

async function call<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (currentUserId) headers.cookie = `skilllink_user=${currentUserId}`

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
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

async function main(): Promise<void> {
  console.log(`${BOLD}Сквозной сценарий SkillLink${RESET}`)
  console.log(`${GREY}Сервер: ${BASE_URL}${RESET}`)

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

  const recommendations = await call<
    Array<{
      id: string
      ruleKey: string
      title: string
      justification: string
      priority: string
      confidence: string
      status: string
      relatedData: Record<string, unknown> | null
    }>
  >('GET', '/api/recommendations?pageSize=50')
  check('GET /api/recommendations отвечает 200', recommendations.status === 200)
  const recs = recommendations.body.data ?? []
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

  const afterRegen = await call<unknown[]>('GET', '/api/recommendations?pageSize=50')
  check(
    'количество рекомендаций не выросло',
    (afterRegen.body.data?.length ?? 0) === recs.length,
    `было ${recs.length}, стало ${afterRegen.body.data?.length ?? 0}`,
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
  }>('GET', '/api/auth/me')
  check('GET /api/auth/me отвечает 200', me.status === 200)
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

    const pending = (repMaterials.body.data ?? []).find((item) => !item.isConfirmed)
    if (pending) {
      const confirmed = await call<Array<{ taskId: string; isConfirmed: boolean; confirmedAt: string | null }>>(
        'POST',
        `/api/portal/materials/${pending.taskId}/confirm`,
        { comment: 'Материалы получены' },
      )
      check('получение материалов подтверждается', confirmed.status === 200)
      const updatedItem = (confirmed.body.data ?? []).find((item) => item.taskId === pending.taskId)
      check('отметка подтверждения сохранена', updatedItem?.isConfirmed === true)
      check('время подтверждения зафиксировано', Boolean(updatedItem?.confirmedAt))
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
