#!/usr/bin/env node
/**
 * Нагрузочный тест (решение 118): чистый Node — fetch и конкурентность, без зависимостей.
 *
 *   node scripts/ops/loadtest.mjs --base http://localhost:3154 --requests 500 --concurrency 20
 *
 * ТОЛЬКО против своей машины: адрес, отличный от localhost/127.0.0.1, — отказ. Стенд
 * для экспертов (skilllink.site) нагружать нельзя ни при каких флагах: тест — это
 * сотни запросов в секунду, для эксперта в этот момент система «тормозит».
 *
 * Сценарии (по умолчанию все по очереди):
 *   login        GET /login — страница входа без сессии;
 *   home         GET / — главная после входа (администратор);
 *   universities GET /api/universities?pageSize=20 — список вузов;
 *   university   GET /api/universities/:id — карточка вуза;
 *   write        POST /api/skills + DELETE /api/skills/:id — одна запись в справочник
 *                и её удаление (операция = пара запросов; в базе ничего не остаётся,
 *                кроме строк журнала действий).
 *
 * Для каждого: прогрев (--warmup запросов, в замер не идут), затем --requests запросов
 * при --concurrency одновременно. Итог: p50/p95/p99, среднее, RPS, коды ответов.
 *
 *   --scenario tz  сценарий буквально по ТЗ (раздел «Приоритет 1», п. 9; решение 146):
 *                  --vusers (по умолчанию 50) виртуальных пользователей, каждый со
 *                  своей сессией под демо-учётками разных ролей (вход один раз —
 *                  не входит в замер), затем цикл «главная → реестр вузов → карточка →
 *                  связка → рекомендации» с паузами 1–3 с между шагами; одновременно
 *                  --reportWorkers (по умолчанию 10) воркеров подряд формируют отчёт
 *                  (GET /api/export?dataset=cooperations — самая тяжёлая выгрузка
 *                  из тех, что есть; готового PDF или отдельного «отчёта руководителю»
 *                  в системе сейчас нет — см. docs/OPERATIONS_TESTS.md). Всё это —
 *                  --duration секунд (по умолчанию 240 — середина диапазона 3–5 минут
 *                  из ТЗ). Метрики и вердикт «требование ТЗ выполнено» — отдельно по
 *                  50 пользователям и по 10 отчётам.
 *
 * Вход — LOADTEST_EMAIL / LOADTEST_PASSWORD (по умолчанию admin@skilllink.demo /
 * SEED_DEMO_PASSWORD или «skilllink»); сценарий tz входит под несколькими демо-учётками
 * с тем же паролем (SEED_DEMO_PASSWORD). Если в сборке есть ограничение частоты
 * запросов (решение 117), для прогона его предел поднимают через env — иначе
 * в итоге будут 429, и тест измерит ограничитель, а не приложение. Для сценария tz
 * используется тот же приём, что и у остальных сценариев: DEMO_AUTH_ENABLED=true
 * (значение .env по умолчанию для локальной сборки, на стенде экспертов оно всегда
 * false) переводит ограничитель в режим только наблюдения (rate-limit-guard.ts,
 * `enforce = !isDemoAuthEnabled()`) — реальный предел прогону не мешает, а его
 * значения из решения 117 продолжают действовать на стенде без каких-либо изменений.
 *
 * --json <файл> — сохранить итог машиночитаемо.
 */
import { writeFileSync } from 'node:fs'
import os from 'node:os'

const args = process.argv.slice(2)
function option(name, fallback) {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}

const BASE = option('base', 'http://localhost:3154').replace(/\/+$/, '')
const REQUESTS = Number(option('requests', '500'))
const CONCURRENCY = Number(option('concurrency', '20'))
const WARMUP = Number(option('warmup', '30'))
const ONLY = option('scenario', 'all')
const JSON_OUT = option('json', '')
const EMAIL = process.env.LOADTEST_EMAIL ?? 'admin@skilllink.demo'
const PASSWORD = process.env.LOADTEST_PASSWORD ?? process.env.SEED_DEMO_PASSWORD ?? 'skilllink'

// ── Сценарий tz (ТЗ, п. 9; решение 146) ───────────────────────────────────────
const TZ_DURATION_SECONDS = Number(option('duration', '240'))
const TZ_VUSERS = Number(option('vusers', '50'))
const TZ_REPORT_WORKERS = Number(option('reportWorkers', '10'))
const TZ_REPORT_DATASET = option('reportDataset', 'cooperations')
const TZ_REPORT_LIMIT = Number(option('reportLimit', '5000'))
const TZ_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? PASSWORD

const host = new URL(BASE).hostname
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
  console.error(`Отказ: ${host} — не эта машина. Нагрузочный тест запускается только локально.`)
  process.exit(1)
}

// ── Вход ─────────────────────────────────────────────────────────────────────

/** Куки из ответа — в строку для заголовка Cookie (только имя=значение). */
function mergeCookies(jar, response) {
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(';')
    const eq = pair.indexOf('=')
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1))
  }
  return jar
}
const cookieHeader = (jar) => [...jar].map(([name, value]) => `${name}=${value}`).join('; ')

/**
 * Вход по паролю через NextAuth. Каждый вызов — свой `jar`, то есть своя сессия
 * (свой токен), даже если несколько вызовов входят под одной и той же демо-учёткой —
 * ровно это нужно для «50 пользователей, каждый со своей сессией» (ТЗ, п. 9).
 */
async function loginAs(email, password) {
  const jar = new Map()
  const csrfResponse = await fetch(`${BASE}/api/auth/csrf`)
  mergeCookies(jar, csrfResponse)
  const { csrfToken } = await csrfResponse.json()
  const response = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader(jar) },
    body: new URLSearchParams({ csrfToken, email, password }),
  })
  mergeCookies(jar, response)
  const session = [...jar.keys()].find((name) => name.endsWith('authjs.session-token'))
  if (!session) {
    throw new Error(
      `Вход не удался для ${email} (${response.status} → ${response.headers.get('location')}). ` +
        'Проверьте пароль (SEED_DEMO_PASSWORD) и что npm run db:seed отработал.',
    )
  }
  return cookieHeader(jar)
}

async function login() {
  return loginAs(EMAIL, PASSWORD)
}

// ── Замер ────────────────────────────────────────────────────────────────────

function percentile(sorted, p) {
  if (sorted.length === 0) return NaN
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)]
}

/**
 * `operation()` возвращает код ответа (или коды — для пары запросов). Бросает —
 * сетевой сбой, считается кодом ERR.
 */
async function run(total, concurrency, operation) {
  const latencies = []
  const codes = {}
  let next = 0
  const started = performance.now()
  async function worker() {
    while (next < total) {
      next += 1
      const t0 = performance.now()
      let result
      try {
        result = await operation()
      } catch {
        result = 'ERR'
      }
      latencies.push(performance.now() - t0)
      for (const code of [result].flat()) codes[code] = (codes[code] ?? 0) + 1
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker))
  const wallMs = performance.now() - started
  latencies.sort((a, b) => a - b)
  return {
    requests: total,
    concurrency,
    wallSeconds: Number((wallMs / 1000).toFixed(2)),
    rps: Number((total / (wallMs / 1000)).toFixed(1)),
    p50: Number(percentile(latencies, 50).toFixed(1)),
    p95: Number(percentile(latencies, 95).toFixed(1)),
    p99: Number(percentile(latencies, 99).toFixed(1)),
    mean: Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(1)),
    max: Number(latencies.at(-1).toFixed(1)),
    codes,
  }
}

async function get(path, cookie) {
  const response = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {}, redirect: 'manual' })
  await response.arrayBuffer()
  return response.status
}

// ── Сценарии ─────────────────────────────────────────────────────────────────

const runTag = Date.now().toString(36)
let writeCounter = 0

function scenarios(cookie, universityId) {
  return {
    login: { title: 'GET /login (без сессии)', op: () => get('/login') },
    home: { title: 'GET / (главная после входа)', op: () => get('/', cookie) },
    universities: { title: 'GET /api/universities?pageSize=20', op: () => get('/api/universities?pageSize=20', cookie) },
    university: { title: 'GET /api/universities/:id', op: () => get(`/api/universities/${universityId}`, cookie) },
    write: {
      title: 'POST /api/skills + DELETE /api/skills/:id',
      op: async () => {
        writeCounter += 1
        const created = await fetch(`${BASE}/api/skills`, {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ name: `нагрузка-${runTag}-${writeCounter}`, category: 'Нагрузочный тест' }),
        })
        const body = await created.json().catch(() => ({}))
        if (created.status !== 201 || !body?.data?.id) return [`POST ${created.status}`]
        const removed = await fetch(`${BASE}/api/skills/${body.data.id}`, { method: 'DELETE', headers: { cookie } })
        await removed.arrayBuffer()
        return [`POST ${created.status}`, `DELETE ${removed.status}`]
      },
    },
  }
}

// ── Сценарий tz: буквально по ТЗ (п. 9; решение 146) ─────────────────────────

/** Демо-учётки разных ролей (сид, seedUsers/seedHeadUser) — по ним распределяются VU. */
const TZ_STAFF_ACCOUNTS = [
  'admin@skilllink.demo',
  'manager@skilllink.demo',
  'manager2@skilllink.demo',
  'analyst@skilllink.demo',
  'viewer@skilllink.demo',
  'head@skilllink.demo',
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const randomPauseMs = () => 1000 + Math.random() * 2000 // 1–3 с, как в ТЗ
const pick = (list) => list[Math.floor(Math.random() * list.length)]

/** Копит латентность и коды по одному виду нагрузки (VU-сценарий или отчёты) — без фиксированного числа запросов, а по времени. */
class StatTracker {
  constructor() {
    this.latencies = []
    this.codes = {}
  }
  record(ms, code) {
    this.latencies.push(ms)
    this.codes[code] = (this.codes[code] ?? 0) + 1
  }
  summary(wallSeconds) {
    const sorted = [...this.latencies].sort((a, b) => a - b)
    const total = sorted.length
    const errorRequests = Object.entries(this.codes)
      .filter(([code]) => code === 'ERR' || code === 'LOGIN_ERR' || Number(code) >= 400)
      .reduce((sum, [, count]) => sum + count, 0)
    return {
      requests: total,
      errorRequests,
      wallSeconds: Number(wallSeconds.toFixed(1)),
      rps: total > 0 ? Number((total / wallSeconds).toFixed(1)) : 0,
      p50: total > 0 ? Number(percentile(sorted, 50).toFixed(1)) : null,
      p95: total > 0 ? Number(percentile(sorted, 95).toFixed(1)) : null,
      p99: total > 0 ? Number(percentile(sorted, 99).toFixed(1)) : null,
      mean: total > 0 ? Number((sorted.reduce((sum, value) => sum + value, 0) / total).toFixed(1)) : null,
      max: total > 0 ? Number(sorted.at(-1).toFixed(1)) : null,
      codes: this.codes,
    }
  }
}

/** Как `run()`, но пишет в общий трекер вместо возврата отдельного итога — для сценария по времени. */
async function timed(tracker, operation) {
  const t0 = performance.now()
  try {
    const result = await operation()
    const ms = performance.now() - t0
    for (const code of [result].flat()) tracker.record(ms, code)
  } catch {
    tracker.record(performance.now() - t0, 'ERR')
  }
}

/**
 * Один виртуальный пользователь: вход один раз (не входит в замер — измеряется
 * только цикл), затем «главная → реестр вузов → карточка → связка → рекомендации»
 * с паузами 1–3 с между шагами до дедлайна (ТЗ, п. 9). Страницы — HTML: одним
 * запросом клиента тянется весь серверный рендер страницы, как у настоящего браузера.
 */
async function vuserLoop(index, deadline, tracker, universityIds, cooperationIds) {
  const email = TZ_STAFF_ACCOUNTS[index % TZ_STAFF_ACCOUNTS.length]
  let cookie
  try {
    cookie = await loginAs(email, TZ_PASSWORD)
  } catch {
    tracker.record(0, 'LOGIN_ERR')
    return
  }

  while (Date.now() < deadline) {
    const universityId = pick(universityIds)
    const cooperationId = pick(cooperationIds)
    const steps = [
      () => get('/', cookie),
      () => get('/universities', cookie),
      () => get(`/universities/${universityId}`, cookie),
      () => get(`/cooperations/${cooperationId}`, cookie),
      () => get('/recommendations', cookie),
    ]
    for (const step of steps) {
      if (Date.now() >= deadline) break
      await timed(tracker, step)
      await sleep(randomPauseMs())
    }
  }
}

/**
 * Один из --reportWorkers воркеров: формирует отчёт подряд, без паузы, до дедлайна —
 * так в любой момент внутри окна прогона одновременно выполняется --reportWorkers
 * формирований (ТЗ, п. 9: «10 параллельных отчётов»). Датасет и предел — --reportDataset
 * / --reportLimit: самая тяжёлая выгрузка из тех, что есть (см. заголовок файла).
 */
async function reportWorkerLoop(deadline, tracker) {
  let cookie
  try {
    cookie = await loginAs('admin@skilllink.demo', TZ_PASSWORD)
  } catch {
    tracker.record(0, 'LOGIN_ERR')
    return
  }
  while (Date.now() < deadline) {
    await timed(tracker, () => get(`/api/export?dataset=${TZ_REPORT_DATASET}&limit=${TZ_REPORT_LIMIT}`, cookie))
  }
}

function printTzSummary(title, requirement, summary) {
  const errors = summary.errorRequests
  const ok = errors === 0
  console.log(`\n${title}`)
  console.log(
    `  запросов: ${summary.requests}  RPS: ${summary.rps}  ` +
      `p50 ${summary.p50 ?? '—'} мс  p95 ${summary.p95 ?? '—'} мс  p99 ${summary.p99 ?? '—'} мс  ` +
      `ошибок: ${errors}`,
  )
  console.log(`  ${requirement} — требование ТЗ выполнено: ${ok ? 'да' : 'нет'}`)
  return ok
}

async function runTzScenario() {
  console.log(`Нагрузочный тест «tz» (буквально по ТЗ, п. 9): ${BASE}`)
  console.log(
    `${TZ_VUSERS} виртуальных пользователей + ${TZ_REPORT_WORKERS} параллельных отчётов, ` +
      `${TZ_DURATION_SECONDS} с (${(TZ_DURATION_SECONDS / 60).toFixed(1)} мин)\n`,
  )

  const setupCookie = await loginAs('admin@skilllink.demo', TZ_PASSWORD)
  const [universities, cooperations] = await Promise.all([
    fetch(`${BASE}/api/universities?pageSize=50`, { headers: { cookie: setupCookie } }).then((r) => r.json()),
    fetch(`${BASE}/api/cooperations?pageSize=50`, { headers: { cookie: setupCookie } }).then((r) => r.json()),
  ])
  const universityIds = (universities?.data ?? []).map((row) => row.id)
  const cooperationIds = (cooperations?.data ?? []).map((row) => row.id)
  if (universityIds.length === 0 || cooperationIds.length === 0) {
    throw new Error('Нет вузов или связок в базе — сначала npm run db:seed')
  }

  const deadline = Date.now() + TZ_DURATION_SECONDS * 1000
  const vuserTracker = new StatTracker()
  const reportTracker = new StatTracker()
  const started = performance.now()

  await Promise.all([
    ...Array.from({ length: TZ_VUSERS }, (_, index) =>
      vuserLoop(index, deadline, vuserTracker, universityIds, cooperationIds),
    ),
    ...Array.from({ length: TZ_REPORT_WORKERS }, () => reportWorkerLoop(deadline, reportTracker)),
  ])

  const wallSeconds = (performance.now() - started) / 1000
  const vuserSummary = vuserTracker.summary(wallSeconds)
  const reportSummary = reportTracker.summary(wallSeconds)

  const vuserOk = printTzSummary(
    `${TZ_VUSERS} параллельных пользователей (главная → реестр вузов → карточка → связка → рекомендации):`,
    `${TZ_VUSERS} параллельных пользователей`,
    vuserSummary,
  )
  const reportOk = printTzSummary(
    `${TZ_REPORT_WORKERS} параллельных формирований отчёта (GET /api/export?dataset=${TZ_REPORT_DATASET}):`,
    `${TZ_REPORT_WORKERS} параллельных отчётов`,
    reportSummary,
  )

  if (JSON_OUT) {
    writeFileSync(
      JSON_OUT,
      JSON.stringify(
        {
          base: BASE,
          scenario: 'tz',
          vusers: TZ_VUSERS,
          reportWorkers: TZ_REPORT_WORKERS,
          durationSeconds: TZ_DURATION_SECONDS,
          vuserSummary,
          reportSummary,
          vuserOk,
          reportOk,
        },
        null,
        2,
      ),
    )
  }

  process.exitCode = vuserOk && reportOk ? 0 : 2
}

async function main() {
  if (ONLY === 'tz') {
    await runTzScenario()
    return
  }

  const cookie = await login()
  const list = await fetch(`${BASE}/api/universities?pageSize=1`, { headers: { cookie } }).then((r) => r.json())
  const universityId = list?.data?.[0]?.id
  if (!universityId) throw new Error('Список вузов пуст — залейте демо-данные (npm run db:seed)')

  const all = scenarios(cookie, universityId)
  const chosen = ONLY === 'all' ? Object.keys(all) : ONLY.split(',')

  const machine = {
    cpu: os.cpus()[0]?.model ?? '?',
    cores: os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 2 ** 30),
    platform: `${os.platform()} ${os.release()}`,
    node: process.version,
  }
  console.log(`Нагрузочный тест: ${BASE}`)
  console.log(`Машина: ${machine.cpu}, ${machine.cores} ядер, ${machine.memoryGb} ГБ, ${machine.platform}, Node ${machine.node}`)
  console.log(`Запросов на сценарий: ${REQUESTS}, одновременно: ${CONCURRENCY}, прогрев: ${WARMUP}\n`)

  const results = {}
  for (const name of chosen) {
    const scenario = all[name]
    if (!scenario) throw new Error(`Нет сценария ${name}`)
    await run(WARMUP, Math.min(CONCURRENCY, 5), scenario.op)
    const result = await run(REQUESTS, CONCURRENCY, scenario.op)
    results[name] = { title: scenario.title, ...result }
    const codes = Object.entries(result.codes)
      .map(([code, count]) => `${code}×${count}`)
      .join(' ')
    console.log(
      `${scenario.title.padEnd(44)} p50 ${String(result.p50).padStart(7)} мс  p95 ${String(result.p95).padStart(7)} мс  ` +
        `p99 ${String(result.p99).padStart(7)} мс  ${String(result.rps).padStart(7)} оп/с  ${codes}`,
    )
  }

  if (JSON_OUT) {
    writeFileSync(
      JSON_OUT,
      JSON.stringify({ base: BASE, requests: REQUESTS, concurrency: CONCURRENCY, warmup: WARMUP, machine, results }, null, 2),
    )
  }
  const unexpected = Object.values(results).some((result) =>
    Object.keys(result.codes).some((code) => !/^(POST 201|DELETE 200|200|ERR)$/.test(code) || code === 'ERR'),
  )
  process.exitCode = unexpected ? 2 : 0
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
