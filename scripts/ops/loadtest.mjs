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
 * Вход — LOADTEST_EMAIL / LOADTEST_PASSWORD (по умолчанию admin@skilllink.demo /
 * SEED_DEMO_PASSWORD или «skilllink»). Если в сборке есть ограничение частоты
 * запросов (решение 117), для прогона его предел поднимают через env — иначе
 * в итоге будут 429, и тест измерит ограничитель, а не приложение.
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

async function login() {
  const jar = new Map()
  const csrfResponse = await fetch(`${BASE}/api/auth/csrf`)
  mergeCookies(jar, csrfResponse)
  const { csrfToken } = await csrfResponse.json()
  const response = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader(jar) },
    body: new URLSearchParams({ csrfToken, email: EMAIL, password: PASSWORD }),
  })
  mergeCookies(jar, response)
  const session = [...jar.keys()].find((name) => name.endsWith('authjs.session-token'))
  if (!session) {
    throw new Error(
      `Вход не удался (${response.status} → ${response.headers.get('location')}). ` +
        'Проверьте LOADTEST_EMAIL / LOADTEST_PASSWORD (SEED_DEMO_PASSWORD).',
    )
  }
  return cookieHeader(jar)
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

async function main() {
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
