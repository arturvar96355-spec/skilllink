/**
 * Сверка стенда со сценарием показа: те ли числа увидит жюри, что записаны
 * в сценарии показа и шпаргалке докладчика (у команды, вне репозитория).
 *
 *   SEED_DEMO_PASSWORD=... npm run demo:check -- https://skilllink.site
 *   npm run demo:check -- http://localhost:3100          # запасной ноутбук
 *
 * Только чтение: входит менеджером и представителем вуза и делает GET-запросы.
 * Против живого стенда запускать можно — в отличие от smoke и probe,
 * которые создают записи. Исключение — шаг 6: `DELETE` эксперта (решение 147) на
 * несуществующий id, права проверяются раньше обращения к базе (`assertCan` в начале
 * сервиса) — до записи не доходит и на живом стенде, отказ 403 гарантирован.
 *
 * Зачем отдельная проверка. Демонстрационные даты считаются от момента
 * заливки (prisma/seed.ts), а время идёт. С решения 121 будущие сроки и встречи
 * сдвинуты за конец экспертизы (SEED_STABLE_UNTIL), и числа держатся до него;
 * но на прогоне кто-то мог закрыть этап или сгенерировать рекомендации заново —
 * и числа на главной разошлись бы с тем, что произносит докладчик.
 * Эта проверка ловит такое расхождение утром, а не перед жюри.
 */
import { RECOMMENDATION_SORT_MOST_IMPORTANT } from '../src/shared/contracts/recommendation'

const BASE_URL = (process.argv[2] ?? process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const PASSWORD = process.env.SEED_DEMO_PASSWORD?.trim() || 'skilllink'

const MANAGER_EMAIL = 'manager@skilllink.demo'
const REP_EMAIL = 'rep@spbgu.example.invalid'
const EXPERT_ADMIN_EMAIL = 'expert-admin@skilllink.demo'

const GREEN = '\u001b[32m'
const RED = '\u001b[31m'
const GREY = '\u001b[90m'
const BOLD = '\u001b[1m'
const RESET = '\u001b[0m'

let failed = 0
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    passed += 1
    console.log(`  ${GREEN}OK${RESET}   ${name} ${GREY}${format(actual)}${RESET}`)
  } else {
    failed += 1
    console.log(`  ${RED}FAIL${RESET} ${name}: на стенде ${format(actual)}, в сценарии ${format(expected)}`)
  }
}

/**
 * Сверка числа с допуском: доли и средние по дням зависят от часа перезаливки
 * и от набора демо-данных (решения 141, 145–147) — сотые не должны ронять сверку.
 */
function checkNear(name: string, actual: unknown, expected: number, tolerance: number): void {
  const ok = typeof actual === 'number' && Math.abs(actual - expected) <= tolerance
  if (ok) {
    passed += 1
    console.log(`  ${GREEN}OK${RESET}   ${name} ${GREY}${format(actual)} (сценарий ${expected} ± ${tolerance})${RESET}`)
  } else {
    failed += 1
    console.log(`  ${RED}FAIL${RESET} ${name}: на стенде ${format(actual)}, в сценарии ${expected} ± ${tolerance}`)
  }
}

function format(value: unknown): string {
  if (value === null) return '«Нет данных»'
  if (typeof value === 'string') return `«${value}»`
  return JSON.stringify(value)
}

function step(title: string): void {
  console.log(`\n${BOLD}${title}${RESET}`)
}

// ─── Сессия ─────────────────────────────────────────────────────────────────

class Session {
  private cookies = new Map<string, string>()

  private header(): Record<string, string> {
    if (this.cookies.size === 0) return {}
    return { cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ') }
  }

  private remember(response: Response): void {
    for (const entry of response.headers.getSetCookie?.() ?? []) {
      const [pair] = entry.split(';')
      const separator = pair?.indexOf('=') ?? -1
      if (!pair || separator <= 0) continue
      const name = pair.slice(0, separator).trim()
      const value = pair.slice(separator + 1).trim()
      if (value === '' || value === 'deleted') this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }

  async login(email: string): Promise<void> {
    const csrfResponse = await fetch(`${BASE_URL}/api/auth/csrf`, { headers: this.header() })
    this.remember(csrfResponse)
    const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string }

    const response = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...this.header() },
      body: new URLSearchParams({ csrfToken, email, password: PASSWORD }).toString(),
      redirect: 'manual',
    })
    this.remember(response)

    const me = await this.get<{ email: string }>('/api/me')
    if (me.status !== 200) {
      throw new Error(
        `Не удалось войти как ${email} (ответ ${me.status}). Пароль стенда — в SEED_DEMO_PASSWORD, ` +
          'у локального запуска он по умолчанию skilllink.',
      )
    }
  }

  async get<T>(path: string): Promise<{ status: number; data: T; meta?: { total?: number } }> {
    const response = await fetch(`${BASE_URL}${path}`, { headers: this.header(), redirect: 'manual' })
    this.remember(response)
    const body = (await response.json().catch(() => ({}))) as { data: T; meta?: { total?: number } }
    return { status: response.status, data: body.data, meta: body.meta }
  }

  /** Только для шага 6: право проверяется до обращения к базе — см. заголовок файла. */
  async del(path: string): Promise<{ status: number; code?: string }> {
    const response = await fetch(`${BASE_URL}${path}`, { method: 'DELETE', headers: this.header(), redirect: 'manual' })
    this.remember(response)
    const body = (await response.json().catch(() => ({}))) as { error?: { code?: string } }
    return { status: response.status, code: body.error?.code }
  }
}

// ─── Ответы API, в той части, что нужна проверке ────────────────────────────

interface Overview {
  metrics: Array<{ key: string; value: number | null }>
  problemCooperations: unknown[]
  problemStageTotal: number
  priorityActions: Array<{ title: string }>
  skillMatch: { coveragePercent: number | null; criticalGaps: number }
}

interface UniversityRow {
  name: string
  rating: { score: number | null } | null
}

interface CooperationRow {
  id: string
  universityName: string
  programName: string
  createdAt?: string
  currentStage: { stageNumber: number } | null
  progress: { completedStages: number; overdueStages: number }
}

interface CooperationCard {
  stages: Array<{
    stageNumber: number
    status: string
    tasks?: Array<{ isRequired: boolean; isDone: boolean }>
  }>
}

interface PortalOverview {
  universityName: string
  programs: unknown[]
  cooperations: unknown[]
  pendingMaterials: number
}

/** Балл так, как его показывает интерфейс: одна цифра после запятой. */
const shown = (score: number | null | undefined) => (score == null ? null : Math.round(score * 10) / 10)

const SPBGUT = 'Санкт-Петербургский государственный университет телекоммуникаций'

async function main(): Promise<void> {
  console.log(`Сверка стенда со сценарием показа: ${BASE_URL}`)

  const manager = new Session()
  await manager.login(MANAGER_EMAIL)

  // ── Шаг 1. Дашборд ──
  step('Шаг 1. Дашборд')
  const overview = (await manager.get<Overview>('/api/analytics/overview')).data
  const metric = (key: string) => overview.metrics.find((item) => item.key === key)?.value ?? null

  // Решение 141 (по замечанию владельца): 89 связок, из них 65 в работе и
  // черновиках, 4–7 на вуз вместо 2–3 — числа шага 1 пересчитаны заново.
  check('активные связи', metric('activeCooperations'), 65)
  check('вузы в работе', metric('universitiesInWork'), 14)
  checkNear('этапы в срок, %', metric('stagesOnTimePercent'), 82.5, 1.5)
  checkNear('дней до начала занятий в среднем', metric('avgDaysToClasses'), 159.8, 1)
  // Больше связок — больше просрочек и блокировок в абсолютных числах;
  // на главной всё равно показывается верхние 10 (решение 84).
  check('проблемных этапов всего', overview.problemStageTotal, 21)
  check('из них показано на главной', overview.problemCooperations.length, 10)
  check('приоритетных действий', overview.priorityActions.length, 5)
  check(
    'верхнее действие',
    overview.priorityActions[0]?.title ?? null,
    // Самая давняя просрочка — подписание у СПбГУТ, та связка, что на шаге 3.
    'Просрочен этап 6: Подписание документов',
  )
  check('покрытие навыков, %', overview.skillMatch.coveragePercent, 92)
  // Kubernetes и PostgreSQL — как прежде, MLOps — третий (решение 131, решение 141:
  // оба всё ещё не преподаются ни одной из 89 программ).
  check('критических дефицитов', overview.skillMatch.criticalGaps, 3)

  // ── Шаг 2. Реестр вузов ──
  step('Шаг 2. Реестр вузов')
  const universities = (await manager.get<UniversityRow[]>('/api/universities?sort=name&pageSize=20')).data
  check(
    'вузы и баллы по порядку',
    universities.map((item) => [item.name, shown(item.rating?.score)]),
    [
      // Рейтинг нормируется от нуля (решение 98): ноль — только у нуля заявок.
      // Решение 141: у каждого вуза (кроме СПбГУТ и УрФУ, сценарные исключения)
      // теперь 4-7 программ вместо 2-6 — средний балл пересчитан заново; шкала
      // нормирования (максимумы 420/180/7) не сдвинута, поэтому СПбГУТ и УрФУ
      // держат прежний балл.
      ['Балтийский федеральный университет им. Иммануила Канта', 44.8],
      ['Воронежский государственный университет', 56.4],
      ['Дальневосточный федеральный университет', 43.4],
      ['Донской государственный технический университет', 34.7],
      ['Иркутский национальный исследовательский технический университет', 46.7],
      ['Казанский национальный исследовательский технический университет', 40.9],
      ['Московский технический университет связи и информатики', 47.3],
      ['Национальный исследовательский Нижегородский государственный университет им. Н. И. Лобачевского', 56.2],
      ['Новосибирский государственный технический университет', 42.7],
      ['Омский государственный технический университет', 37.7],
      ['Пермский национальный исследовательский политехнический университет', 45.2],
      ['Поволжский государственный университет телекоммуникаций и информатики', 60.8],
      [SPBGUT, 85.7],
      ['Сибирский федеральный университет', 45.3],
      ['Университет Иннополис', 46.9],
      ['Уральский федеральный университет', null],
      ['Уфимский университет науки и технологий', 58.4],
    ],
  )
  const allCooperations = await manager.get<unknown[]>('/api/cooperations?pageSize=1')
  check('связок всего', allCooperations.meta?.total ?? null, 89)

  // ── Шаг 3. Связка ──
  step('Шаг 3. Связка СПбГУТ — Программная инженерия')
  const list = (await manager.get<CooperationRow[]>(`/api/cooperations?q=${encodeURIComponent('Программная инженерия')}&pageSize=50`)).data
  const row = list.find((item) => item.universityName === SPBGUT && item.programName === 'Программная инженерия')
  if (!row) {
    check('связка есть в реестре', false, true)
  } else {
    check('текущий этап', row.currentStage?.stageNumber ?? null, 6)
    check('пройдено этапов', row.progress.completedStages, 5)
    // Просрочен сам шестой; 7–10 за контрольной точкой — «план сдвинут».
    check('просрочено этапов', row.progress.overdueStages, 1)

    const card = (await manager.get<CooperationCard>(`/api/cooperations/${row.id}`)).data
    const stage = (number: number) => card.stages.find((item) => item.stageNumber === number)
    // Оба отказа держатся на этом состоянии. Если этап 6 кто-то закрыл
    // на прогоне, отказа на показе не будет — стенд надо перезалить.
    check('этап 6 в работе (отказ по чек-листу)', stage(6)?.status ?? null, 'IN_PROGRESS')
    const required = stage(6)?.tasks?.filter((task) => task.isRequired) ?? []
    check('чек-лист этапа 6: закрыто из обязательных', `${required.filter((task) => task.isDone).length} из ${required.length}`, '0 из 3')
    check('этап 7 не начат (отказ контрольной точки)', stage(7)?.status ?? null, 'NOT_STARTED')

  }

  // ── Шаг 4. Рекомендации ──
  // Тот же запрос, что делает лента: иначе проверка видела бы не то, что жюри.
  step('Шаг 4. Рекомендации')
  const recommendations = (
    await manager.get<Array<{ title: string; priority: string; createdAt?: string }>>(
      `/api/recommendations?sort=${RECOMMENDATION_SORT_MOST_IMPORTANT}&page=1&pageSize=20`,
    )
  ).data
  // Решение 141: 89 связок вместо 50 дают больше просрочек, чем 6 верхних мест —
  // дефициты навыков (Kubernetes/PostgreSQL/MLOps, тоже HIGH) сдвинуты глубже
  // в ленту (позиции 11-13 из 20 на первой странице), но никуда не пропали.
  //
  // Решение 147: порядок внутри CRITICAL — гибрид (приоритет первым ключом, балл —
  // тай-брейк), а не по дате создания, как было. Три верхние строки и следующие
  // три — те же семь просрочек, что и раньше, но в другом порядке внутри уровня.
  check(
    'сверху три критичные просрочки — гибрид приоритет+балл (решение 147)',
    recommendations.slice(0, 3).map((item) => [item.priority, item.title]),
    [
      ['CRITICAL', 'Просрочен этап 10: Обновление образовательной программы'],
      ['CRITICAL', 'Просрочен этап 7: Передача учебных материалов, лицензии и документации'],
      ['CRITICAL', 'Просрочен этап 6: Подписание документов'],
    ],
  )
  check(
    'под ними — ещё критичные и важные просрочки расширенного набора',
    recommendations.slice(3, 6).map((item) => item.title),
    [
      'Просрочен этап 6: Подписание документов',
      'Просрочен этап 9: Обучение преподавателей',
      'Просрочен этап 3: Организация встречи',
    ],
  )
  check(
    'дефициты навыков по спросу — на первой странице ленты, ниже просрочек',
    recommendations.map((item) => item.title).filter((title) => title.startsWith('Дефицит навыка')),
    [
      'Дефицит навыка «Kubernetes» закрывается нашим продуктом',
      'Дефицит навыка «PostgreSQL» закрывается нашим продуктом',
      'Дефицит навыка «MLOps» закрывается нашим продуктом',
    ],
  )

  // Когда залиты данные: рекомендации движок выдаёт в момент заливки. Карточка
  // связки для этого не годится — её дата по сюжету, а не момент заливки (решение 85).
  const newest = recommendations
    .map((item) => (item.createdAt ? new Date(item.createdAt).getTime() : 0))
    .reduce((latest, time) => Math.max(latest, time), 0)
  if (newest > 0) {
    const days = (Date.now() - newest) / (24 * 60 * 60 * 1000)
    console.log(
      `  ${GREY}··   демо-данные залиты ${new Date(newest).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК, ` +
        `${days.toFixed(1).replace('.', ',')} сут. назад; сроки и встречи держатся до конца экспертизы (решение 131)${RESET}`,
    )
  }

  // ── Шаг 5. Представитель вуза ──
  step('Шаг 5. Кабинет представителя вуза')
  const rep = new Session()
  await rep.login(REP_EMAIL)
  const portal = (await rep.get<PortalOverview>('/api/portal/overview')).data
  check('вуз', portal.universityName, SPBGUT)
  check('программ', portal.programs.length, 2)
  check('связок', portal.cooperations.length, 2)
  // Этап 7 «Программной инженерии» — контрольная точка, договор не подписан:
  // материалы не переданы, подтверждать нечего (решение 49).
  check('материалов к подтверждению', portal.pendingMaterials, 0)
  const materials = (
    await rep.get<Array<{ programName: string; canConfirm: boolean; lockedReason: string | null }>>(
      '/api/portal/materials',
    )
  ).data
  check(
    'материалы «Программной инженерии» ещё не переданы',
    materials
      .filter((item) => item.programName === 'Программная инженерия')
      .map((item) => [item.canConfirm, item.lockedReason]),
    Array.from({ length: 3 }, () => [false, 'Не закрыт этап 6 «Подписание документов»']),
  )
  check('аналитика закрыта', (await rep.get('/api/analytics/overview')).status, 403)
  check('рекомендации закрыты', (await rep.get('/api/recommendations')).status, 403)

  // ── Шаг 6. Учётная запись эксперта (решение 147) ──
  step('Шаг 6. Учётная запись эксперта — только чтение')
  const expertAdmin = new Session()
  await expertAdmin.login(EXPERT_ADMIN_EMAIL)
  check('чтение доступно эксперту-администратору', (await expertAdmin.get('/api/universities')).status, 200)
  const deleteAttempt = await expertAdmin.del('/api/skills/demo-check-does-not-exist')
  check('разрушающий маршрут отдаёт 403 эксперту', deleteAttempt.status, 403)
  check('причина отказа — учётная запись эксперта', deleteAttempt.code, 'FORBIDDEN')

  console.log()
  if (failed > 0) {
    console.log(`  ${RED}Расхождений со сценарием: ${failed}${RESET} (совпало ${passed})`)
    console.log(
      '  Числа уехали со временем или после прогона — перезалейте демо-данные:\n' +
        '  scripts/deploy/reseed.sh (стенд) или npm run db:seed с базой skilllink_demo (ноутбук), docs/DEPLOY.md.\n' +
        '  Если и после перезаливки расходится — изменился код или сценарий, их надо свести.',
    )
    process.exit(1)
  }
  console.log(`  ${GREEN}Всё как в сценарии: ${passed}${RESET}`)
}

main().catch((error: unknown) => {
  console.error(`${RED}${error instanceof Error ? error.message : String(error)}${RESET}`)
  process.exit(1)
})
