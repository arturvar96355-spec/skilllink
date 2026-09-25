/**
 * Замер времени ответа против запущенного сервера.
 * Нужен, чтобы утверждение «страницы отвечают быстрее N мс» можно было проверить,
 * а не принимать на слово.
 *
 *   npm run dev      (в одном окне)
 *   npm run bench    (в другом)
 */

/**
 * Адрес — из той же переменной APP_BASE_URL, что у сквозного сценария и пробника.
 * BENCH_BASE_URL поддерживается как запасное имя, приоритет у общего.
 */
const BASE = process.env.APP_BASE_URL ?? process.env.BENCH_BASE_URL ?? 'http://localhost:3000'
const RUNS = Number(process.env.BENCH_RUNS ?? 7)

const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const GREY = '\x1b[90m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

let cookie = ''

async function measure(path: string): Promise<{ median: number; worst: number; status: number }> {
  const timings: number[] = []
  let status = 0

  // Первый ответ прогревает соединение и кеш планов — в замер не идёт.
  for (let run = 0; run <= RUNS; run += 1) {
    const startedAt = performance.now()
    const response = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {} })
    await response.arrayBuffer()
    status = response.status
    if (run > 0) timings.push(performance.now() - startedAt)
  }

  timings.sort((left, right) => left - right)
  return {
    median: timings[Math.floor(timings.length / 2)] ?? 0,
    worst: timings[timings.length - 1] ?? 0,
    status,
  }
}

const SCENARIOS: Array<[string, string]> = [
  ['Дашборд', '/api/analytics/overview'],
  ['Реестр вузов', '/api/universities?pageSize=20'],
  ['Реестр вузов с рейтингом', '/api/universities?pageSize=20&withRating=true'],
  ['Реестр вузов, сортировка по рейтингу', '/api/universities?pageSize=20&sort=-rating'],
  ['Реестр вузов, фильтр по рейтингу', '/api/universities?pageSize=20&minRating=30'],
  ['Карточка вуза', ''],
  ['Реестр программ', '/api/programs?pageSize=20'],
  ['Рейтинг программ', '/api/analytics/programs'],
  ['Список связок', '/api/cooperations?pageSize=20'],
  ['Карточка связки со всеми этапами', ''],
  ['Дефицит навыков', '/api/skills/gaps'],
  ['Рекомендации', '/api/recommendations?pageSize=20'],
]

async function main(): Promise<void> {
  const usersResponse = await fetch(`${BASE}/api/users`)
  if (usersResponse.ok) {
    const body = (await usersResponse.json()) as { data?: Array<{ id: string; role: string }> }
    const manager = body.data?.find((user) => user.role === 'MANAGER') ?? body.data?.[0]
    if (manager) cookie = `skilllink_user=${manager.id}`
  }

  const universities = await fetch(`${BASE}/api/universities?pageSize=1`, {
    headers: cookie ? { cookie } : {},
  })
  const universityId =
    ((await universities.json()) as { data?: Array<{ id: string }> }).data?.[0]?.id ?? ''

  const cooperations = await fetch(`${BASE}/api/cooperations?pageSize=1`, {
    headers: cookie ? { cookie } : {},
  })
  const cooperationId =
    ((await cooperations.json()) as { data?: Array<{ id: string }> }).data?.[0]?.id ?? ''

  console.log(`${BOLD}Замер против ${BASE}${RESET}`)
  console.log(`${GREY}${RUNS} прогонов на сценарий, первый отбрасывается${RESET}\n`)

  let slowest = 0

  for (const [title, rawPath] of SCENARIOS) {
    const path =
      rawPath ||
      (title.includes('связки')
        ? `/api/cooperations/${cooperationId}`
        : `/api/universities/${universityId}`)

    const { median, worst, status } = await measure(path)
    slowest = Math.max(slowest, median)

    const colour = median < 100 ? GREEN : median < 300 ? YELLOW : RED
    const note = status >= 400 ? ` ${RED}статус ${status}${RESET}` : ''
    console.log(
      `  ${title.padEnd(38)} ${colour}${median.toFixed(0).padStart(5)} мс${RESET}` +
        `${GREY}  худший ${worst.toFixed(0)} мс${RESET}${note}`,
    )
  }

  console.log(`\n${BOLD}Самый медленный сценарий: ${slowest.toFixed(0)} мс${RESET}`)
}

main().catch((error) => {
  console.error('Замер упал:', error)
  process.exitCode = 1
})
