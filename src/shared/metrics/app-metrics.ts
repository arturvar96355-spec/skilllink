import { readFile } from 'node:fs/promises'
import { monitorEventLoopDelay, type ELDHistogram } from 'node:perf_hooks'
import packageJson from '../../../package.json'
import {
  AUDIT_CHAIN_CACHE_MS,
  DB_PING_TIMEOUT_MS,
  EVENT_LOOP_RESOLUTION_MS,
  HTTP_DURATION_BUCKETS,
} from '@/shared/config/metrics.config'
import { Counter, Histogram, Registry } from './registry'

/**
 * Метрики приложения (решение 137): один реестр на процесс.
 *
 * Реестр лежит в `globalThis`, а не в переменной модуля: Next собирает каждый
 * маршрут отдельно, и в dev-режиме модули перезагружаются — переменная модуля
 * дала бы каждому маршруту свой счёт. Так же устроен клиент Prisma (shared/db/prisma.ts).
 *
 * Здесь нет ни адресов, ни id записей, ни почты: только счётчики по шаблону
 * маршрута, группе ограничения и причине отказа. Метрики — не журнал; кто
 * и что делал, отвечает журнал действий.
 */

export interface AppMetrics {
  registry: Registry
  httpRequests: Counter
  httpDuration: Histogram
  rateLimitRejections: Counter
  loginFailures: Counter
  captchaRequired: Counter
}

/** Проверка базы: подменяется в тестах. По умолчанию — `SELECT 1` через Prisma. */
export type DatabasePing = () => Promise<void>

const defaultPing: DatabasePing = async () => {
  // Prisma подгружается при сборе, а не при импорте: обёртку маршрутов
  // (shared/http) импортирует всё приложение, и тянуть в неё клиент базы незачем.
  const { prisma } = await import('@/shared/db/prisma')
  await prisma.$queryRaw`SELECT 1`
}

let ping: DatabasePing = defaultPing

/** Только для тестов: подменить проверку базы. */
export function setDatabasePing(next: DatabasePing | null): void {
  ping = next ?? defaultPing
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`нет ответа за ${ms} мс`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** Коммит сборки: только шестнадцатеричный хеш, остальное — `unknown`. */
export function buildCommit(raw: string | undefined): string {
  const value = raw?.trim() ?? ''
  return /^[0-9a-f]{4,40}$/i.test(value) ? value.toLowerCase() : 'unknown'
}

/**
 * Отметка ночной копии (scripts/deploy/backup-mark.sh):
 * `{"timestamp": <секунды>, "sizeBytes": <байты>, "file": "…", "finishedAt": "…"}`.
 * `null` — файла нет или он не разбирается.
 */
export async function readBackupMarker(path: string): Promise<{ timestamp: number; sizeBytes: number } | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as { timestamp?: unknown; sizeBytes?: unknown }
    const timestamp = Number(parsed.timestamp)
    const sizeBytes = Number(parsed.sizeBytes)
    if (!Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(sizeBytes) || sizeBytes < 0) return null
    return { timestamp, sizeBytes }
  } catch {
    return null
  }
}

function create(): AppMetrics {
  const registry = new Registry()

  const httpRequests = registry.counter(
    'http_requests_total',
    'Запросы к API по методу, шаблону маршрута и классу ответа',
    ['method', 'route', 'status_class'],
  )
  const httpDuration = registry.histogram(
    'http_request_duration_seconds',
    'Время ответа API до начала передачи тела, секунды',
    ['method', 'route'],
    HTTP_DURATION_BUCKETS,
  )
  const rateLimitRejections = registry.counter(
    'rate_limit_rejections_total',
    'Отказы 429 общего ограничения частоты запросов по группе (решение 117)',
    ['group'],
  )
  const loginFailures = registry.counter(
    'auth_login_failures_total',
    'Неудачные входы: credentials — неверная пара почта/пароль, throttled — вход закрыт после неудач',
    ['reason'],
  )
  const captchaRequired = registry.counter(
    'captcha_required_total',
    'Входы, остановленные требованием проверки «не робот»',
  )

  // ── Сборка ─────────────────────────────────────────────────────────────────
  const buildInfo = registry.gauge('app_build_info', 'Версия и коммит работающей сборки', ['version', 'commit'])
  buildInfo.set(1, { version: String(packageJson.version), commit: buildCommit(process.env.APP_COMMIT) })

  // ── Процесс ────────────────────────────────────────────────────────────────
  const resident = registry.gauge('process_resident_memory_bytes', 'Занятая процессом память (RSS), байты')
  const heapUsed = registry.gauge('process_heap_used_bytes', 'Занятая куча V8, байты')
  const heapTotal = registry.gauge('process_heap_total_bytes', 'Выделенная куча V8, байты')
  const cpu = registry.counter('process_cpu_seconds_total', 'Процессорное время процесса, секунды')
  const startTime = registry.gauge('process_start_time_seconds', 'Время запуска процесса, секунды Unix')
  const uptime = registry.gauge('process_uptime_seconds', 'Сколько процесс работает, секунды')
  const loopLag = registry.gauge(
    'process_event_loop_lag_seconds',
    'Задержка цикла событий с прошлого сбора: p50, p99 и максимум, секунды',
    ['stat'],
  )

  const startedAt = Date.now() / 1000 - process.uptime()
  let loop: ELDHistogram | null = null
  try {
    loop = monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS })
    loop.enable()
  } catch {
    loop = null
  }

  registry.addCollector(() => {
    const memory = process.memoryUsage()
    resident.set(memory.rss)
    heapUsed.set(memory.heapUsed)
    heapTotal.set(memory.heapTotal)
    const usage = process.cpuUsage()
    cpu.sync((usage.user + usage.system) / 1e6)
    startTime.set(Math.round(startedAt))
    uptime.set(Math.round(process.uptime()))
    if (loop && loop.count > 0) {
      // Наносекунды → секунды. Окно — с прошлого сбора: иначе один давний
      // всплеск навсегда остался бы в максимуме.
      loopLag.set(loop.percentile(50) / 1e9, { stat: 'p50' })
      loopLag.set(loop.percentile(99) / 1e9, { stat: 'p99' })
      loopLag.set(loop.max / 1e9, { stat: 'max' })
      loop.reset()
    }
  })

  // ── База ───────────────────────────────────────────────────────────────────
  const dbUp = registry.gauge('db_up', 'База ответила на SELECT 1 при этом сборе: 1 — да, 0 — нет')
  const dbPing = registry.gauge('db_ping_seconds', 'Время ответа базы на SELECT 1 при этом сборе, секунды')
  registry.addCollector(async () => {
    const started = performance.now()
    try {
      if (!process.env.DATABASE_URL) throw new Error('не задан DATABASE_URL')
      await withTimeout(ping(), DB_PING_TIMEOUT_MS)
      dbUp.set(1)
    } catch {
      dbUp.set(0)
    }
    dbPing.set(Number(((performance.now() - started) / 1000).toFixed(6)))
  })

  // ── Пул соединений с базой ────────────────────────────────────────────────
  const poolTotal = registry.gauge('db_pool_total_connections', 'Соединений в пуле (свободных и занятых)')
  const poolIdle = registry.gauge('db_pool_idle_connections', 'Свободных соединений в пуле')
  const poolWaiting = registry.gauge('db_pool_waiting_requests', 'Запросов, ждущих свободного соединения')
  registry.addCollector(async () => {
    // Модуль клиента подгружается лениво (см. defaultPing) — до первого обращения
    // к базе пула ещё нет, и это не сбой: значит, счётчики просто отсутствуют.
    const { poolStats } = await import('@/shared/db/prisma')
    const stats = poolStats()
    poolTotal.reset()
    poolIdle.reset()
    poolWaiting.reset()
    if (!stats) return
    poolTotal.set(stats.total)
    poolIdle.set(stats.idle)
    poolWaiting.set(stats.waiting)
  })

  // ── Цепочка журнала (решение 115) ─────────────────────────────────────────
  const chainOk = registry.gauge(
    'audit_chain_ok',
    'Цепочка хешей журнала действий цела на момент последней проверки: 1 — да, 0 — нет',
  )
  const chainCheckedAt = registry.gauge(
    'audit_chain_checked_at_seconds',
    'Когда в последний раз проверялась цепочка журнала, секунды Unix',
  )
  let chainCachedAt = 0
  registry.addCollector(async () => {
    const now = Date.now()
    if (now - chainCachedAt < AUDIT_CHAIN_CACHE_MS) return
    try {
      // Модуля может не быть на ветке, где решение 115 ещё не слито, — тогда
      // метрики просто нет вовсе, как и написано в решении 137.
      const { verifyChain } = await import('@/modules/audit/chain.service')
      const report = await verifyChain()
      chainOk.set(report.ok ? 1 : 0)
      chainCheckedAt.set(Math.floor(report.verifiedAt.getTime() / 1000))
      chainCachedAt = now
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ERR_MODULE_NOT_FOUND') throw error
    }
  })

  // ── Ночная копия ───────────────────────────────────────────────────────────
  const backupReadable = registry.gauge(
    'backup_marker_readable',
    'Отметка ночной копии прочитана: 1 — да, 0 — файла нет или он испорчен',
  )
  const backupTime = registry.gauge('backup_last_success_timestamp_seconds', 'Когда закончилась последняя удачная ночная копия, секунды Unix')
  const backupSize = registry.gauge('backup_last_size_bytes', 'Размер последней удачной ночной копии, байты')
  registry.addCollector(async () => {
    const path = process.env.BACKUP_STATUS_FILE?.trim()
    backupReadable.reset()
    backupTime.reset()
    backupSize.reset()
    // Не задан путь — метрик копии нет вовсе (разработка, CI): отсутствие
    // метрики не путается с «копии нет».
    if (!path) return
    const marker = await readBackupMarker(path)
    backupReadable.set(marker ? 1 : 0)
    if (!marker) return
    backupTime.set(marker.timestamp)
    backupSize.set(marker.sizeBytes)
  })

  return { registry, httpRequests, httpDuration, rateLimitRejections, loginFailures, captchaRequired }
}

const KEY = Symbol.for('skilllink.metrics')

/** Метрики процесса: заводятся при первом обращении. */
export function appMetrics(): AppMetrics {
  const holder = globalThis as unknown as Record<symbol, AppMetrics | undefined>
  let metrics = holder[KEY]
  if (!metrics) {
    metrics = create()
    holder[KEY] = metrics
  }
  return metrics
}

/**
 * Приращение счётчика, которое никогда не ломает запрос: метрики — наблюдение,
 * и ошибка в них не должна стоить пользователю ответа.
 */
export function countSafely(action: (metrics: AppMetrics) => void): void {
  try {
    action(appMetrics())
  } catch (error) {
    console.warn('[METRICS] не удалось учесть:', error instanceof Error ? error.message : 'ошибка')
  }
}
