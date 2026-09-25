/**
 * Сверка стенда со сценарием показа: те ли числа увидит жюри, что записаны
 * в сценарии показа и шпаргалке докладчика (у команды, вне репозитория).
 *
 *   SEED_DEMO_PASSWORD=... npm run demo:check -- https://skilllink.site
 *   npm run demo:check -- http://localhost:3100          # запасной ноутбук
 *
 * Только чтение: входит менеджером и представителем вуза и делает GET-запросы.
 * Против живого стенда запускать можно — в отличие от smoke и probe,
 * которые создают записи.
 *
 * Зачем отдельная проверка. Демонстрационные даты считаются от момента
 * заливки (prisma/seed.ts), а время идёт. Через двое суток после заливки
 * у первого этапа выходит срок, и на главной вместо двенадцати проблемных
 * этапов становится тринадцать, через четверо — пятнадцать. Докладчик
 * произносит «двенадцать», а на экране другое число. Эта проверка ловит
 * такое расхождение утром, а не перед жюри.
 */
import { RECOMMENDATION_SORT_MOST_IMPORTANT } from '../src/shared/contracts/recommendation'

const BASE_URL = (process.argv[2] ?? process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const PASSWORD = process.env.SEED_DEMO_PASSWORD?.trim() || 'skilllink'

const MANAGER_EMAIL = 'manager@skilllink.demo'
const REP_EMAIL = 'rep@spbgu.example.invalid'

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
  createdAt: string
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

  check('активные связи', metric('activeCooperations'), 7)
  check('вузы в работе', metric('universitiesInWork'), 4)
  check('этапы в срок, %', metric('stagesOnTimePercent'), 89.1)
  // 186: у СПбГУТ ИБ занятия идут два месяца — этапы 11–12 закрыты после их начала.
  check('дней до начала занятий в среднем', metric('avgDaysToClasses'), 186)
  // По одному этапу на связку: не начатые этапы с вышедшим сроком — «план
  // сдвинут», а не просрочка, и в счётчик не идут (решение 84).
  check('проблемных этапов всего', overview.problemStageTotal, 4)
  check('из них показано на главной', overview.problemCooperations.length, 4)
  check('приоритетных действий', overview.priorityActions.length, 5)
  check(
    'верхнее действие',
    overview.priorityActions[0]?.title ?? null,
    // Самая давняя просрочка — подписание у СПбГУТ, та связка, что на шаге 3.
    'Просрочен этап 6: Подписание документов',
  )
  check('покрытие навыков, %', overview.skillMatch.coveragePercent, 88.9)
  check('критических дефицитов', overview.skillMatch.criticalGaps, 2)

  // ── Шаг 2. Реестр вузов ──
  step('Шаг 2. Реестр вузов')
  const universities = (await manager.get<UniversityRow[]>('/api/universities?sort=name&pageSize=20')).data
  check(
    'вузы и баллы по порядку',
    universities.map((item) => [item.name, shown(item.rating?.score)]),
    [
      ['Донской государственный технический университет', 7.5],
      ['Казанский национальный исследовательский технический университет', 23.4],
      ['Московский технический университет связи и информатики', 28],
      ['Новосибирский государственный технический университет', 22.7],
      [SPBGUT, 79.1],
      ['Уральский федеральный университет', null],
    ],
  )

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

    const seededAt = new Date(card.createdAt)
    const days = (Date.now() - seededAt.getTime()) / (24 * 60 * 60 * 1000)
    console.log(
      `  ${GREY}··   демо-данные залиты ${seededAt.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК, ` +
        `${days.toFixed(1).replace('.', ',')} сут. назад; числа сценария держатся двое суток${RESET}`,
    )
  }

  // ── Шаг 4. Рекомендации ──
  // Тот же запрос, что делает лента: иначе проверка видела бы не то, что жюри.
  step('Шаг 4. Рекомендации')
  const recommendations = (
    await manager.get<Array<{ title: string; priority: string }>>(
      `/api/recommendations?sort=${RECOMMENDATION_SORT_MOST_IMPORTANT}&page=1&pageSize=20`,
    )
  ).data
  check(
    'сверху три критичные просрочки, от самой давней',
    recommendations.slice(0, 3).map((item) => [item.priority, item.title]),
    [
      ['CRITICAL', 'Просрочен этап 6: Подписание документов'],
      ['CRITICAL', 'Просрочен этап 3: Организация встречи'],
      ['CRITICAL', 'Просрочен этап 5: Доработка документов при необходимости'],
    ],
  )
  check(
    'под ними важная просрочка и дефициты навыков по спросу',
    recommendations.slice(3, 6).map((item) => item.title),
    [
      'Просрочен этап 7: Передача учебных материалов, лицензии и документации',
      'Дефицит навыка «Kubernetes» закрывается нашим продуктом',
      'Дефицит навыка «PostgreSQL» закрывается нашим продуктом',
    ],
  )

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
