import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { UserRole } from '@/shared/contracts/enums'

/**
 * Учётная запись эксперта хакатона (флаг `isReviewer`, решение 147) ничего не меняет —
 * сплошная проверка по всем изменяющим маршрутам `src/app/api/**` (решение 225,
 * находка Codex 1: `task/done` пропускал эксперта, потому что права решала роль).
 *
 * 1. Каждый POST/PUT/PATCH/DELETE внесён в таблицу ниже с видом доступа. Новый
 *    изменяющий маршрут без строки в таблице роняет тест — классифицировать его
 *    придётся явно, а не «по умолчанию открыто».
 * 2. Каждый маршрут вида `forbidden` вызывается настоящим обработчиком под экспертом
 *    с ролями ADMIN, HEAD, MANAGER, UNIVERSITY_REP: ответ 403 FORBIDDEN, и ни одной
 *    записи в базу (включая журнал действий). База подменена: чтение отдаёт «пусто»,
 *    любая запись фиксируется и падает. Разбор тела и файла подменён — проверка
 *    прав не должна зависеть от того, прошло ли тело валидацию.
 */

const state = vi.hoisted(() => ({
  user: null as CurrentUser | null,
  writes: [] as string[],
  /** Что отдаёт чтение `model.method` — для маршрутов, которые читают запись до проверки эксперта. */
  reads: {} as Record<string, unknown>,
}))

const WRITE_METHODS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
])

vi.mock('@/shared/db/prisma', () => {
  function modelProxy(model: string): unknown {
    return new Proxy(
      {},
      {
        get(_target, method: string) {
          return async () => {
            const fixture = `${model}.${method}`
            if (fixture in state.reads) return state.reads[fixture]
            if (WRITE_METHODS.has(method)) {
              state.writes.push(`${model}.${method}`)
              throw new Error(`Запись в базу под экспертом: ${model}.${method}`)
            }
            if (method === 'findMany' || method === 'groupBy') return []
            if (method === 'count') return 0
            if (method === 'aggregate') return {}
            return null
          }
        },
      },
    )
  }
  const client: unknown = new Proxy(
    {},
    {
      get(_target, property: string) {
        if (property === 'then') return undefined
        if (property === '$transaction') {
          return async (arg: unknown) =>
            typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(client) : Promise.all(arg as unknown[])
        }
        if (property === '$executeRaw' || property === '$executeRawUnsafe') {
          return async () => {
            state.writes.push(property)
            throw new Error(`Запись в базу под экспертом: ${property}`)
          }
        }
        if (property === '$queryRaw' || property === '$queryRawUnsafe') return async () => []
        return modelProxy(property)
      },
    },
  )
  return { prisma: client, poolStats: () => null }
})

vi.mock('@/shared/auth/auth', () => ({
  auth: async () => null,
  resolveSecret: () => 'test-secret-test-secret-test-secret',
  handlers: { GET: async () => new Response(null), POST: async () => new Response(null) },
  signIn: async () => undefined,
  signOut: async () => undefined,
  unstable_update: async () => undefined,
}))

vi.mock('@/shared/auth/current-user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/auth/current-user')>()),
  getCurrentUser: async () => state.user,
}))

vi.mock('@/shared/http/rate-limit-guard', () => ({ withRateLimit: (fn: unknown) => fn }))
vi.mock('@/shared/http/metrics-guard', () => ({ withMetrics: (fn: unknown) => fn }))

vi.mock('@/shared/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/http')>()),
  parseBody: async () => ({}),
  parseOptionalBody: async () => ({}),
  parseQuery: () => ({}),
  parseSingleFileUpload: async () => ({
    name: 'file.pdf',
    type: 'application/pdf',
    size: 5,
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
  }),
}))

// ─────────────────────────── Таблица изменяющих маршрутов ───────────────────────────

type Access =
  /** Эксперту — 403, в базе ничего не меняется. Проверяется вызовом обработчика. */
  | { kind: 'forbidden' }
  /** Личная настройка своей учётной записи, не данные системы — эксперту открыта. */
  | { kind: 'personal'; why: string }
  /** Только чтение (текст, показ), в базу — лишь запись журнала — эксперту открыто. */
  | { kind: 'read-only'; why: string }
  /** Без сессии пользователя: вход, вебхуки, приём извне, заглушка 404. */
  | { kind: 'no-session'; why: string }

const FORBIDDEN: Access = { kind: 'forbidden' }

const ROUTES: Record<string, Access> = {
  'POST /api/admin/approvals/[id]/approve': FORBIDDEN,
  'POST /api/admin/approvals/[id]/reject': FORBIDDEN,
  'POST /api/admin/approvals': FORBIDDEN,
  'POST /api/admin/channels/[id]/test': FORBIDDEN,
  'POST /api/admin/dsar/contacts/[id]/erase': FORBIDDEN,
  'POST /api/admin/dsar/requests': FORBIDDEN,
  'POST /api/admin/dsar/users/[id]/erase': FORBIDDEN,
  'PUT /api/admin/telegram/mode': FORBIDDEN,
  'POST /api/admin/telegram/rotate-webhook-secret': FORBIDDEN,
  'POST /api/admin/telegram/test': FORBIDDEN,
  'PUT /api/admin/telegram/token': FORBIDDEN,
  'DELETE /api/admin/telegram/token': FORBIDDEN,
  'POST /api/ai/rewrite': {
    kind: 'read-only',
    why: 'переделка текста черновика, в базу не пишет; письмо по рекомендации и ответ на письмо закрыты эксперту в сервисах (WRITE, INBOUND_REVIEW), письмо-предложение открыто (решение 223)',
  },
  'POST /api/ai/today': { kind: 'read-only', why: 'план дня текстом (ANALYTICS), в базу — только журнал ИИ' },
  'POST /api/analytics/forecast/train': FORBIDDEN,
  'PATCH /api/assignments/[id]': FORBIDDEN,
  'POST /api/assignments': FORBIDDEN,
  'POST /api/contacts/[id]/reveal': { kind: 'read-only', why: 'показ почты и телефона (CONTACT_DETAILS — чтение), журнал показа' },
  'POST /api/cooperations/[id]/ai-summary': { kind: 'read-only', why: 'сводка текстом (ANALYTICS), в базу — только журнал ИИ' },
  'POST /api/cooperations/[id]/documents/generate': FORBIDDEN,
  'POST /api/cooperations/[id]/proposals/[proposalId]/apply': FORBIDDEN,
  'POST /api/cooperations/[id]/proposals': FORBIDDEN,
  'PATCH /api/cooperations/[id]': FORBIDDEN,
  'POST /api/cooperations': FORBIDDEN,
  'POST /api/data-quality/duplicates/dismiss': FORBIDDEN,
  'POST /api/data-sources/sync': FORBIDDEN,
  'POST /api/documents/[id]/files': FORBIDDEN,
  'PATCH /api/documents/[id]': FORBIDDEN,
  'PATCH /api/documents/[id]/status': FORBIDDEN,
  'POST /api/documents/[id]/versions': FORBIDDEN,
  'POST /api/documents': FORBIDDEN,
  'DELETE /api/files/[id]': FORBIDDEN,
  'POST /api/import': FORBIDDEN,
  'POST /api/import/site-orders/lms-file': FORBIDDEN,
  'POST /api/import/site-orders': FORBIDDEN,
  'POST /api/import/vendors': FORBIDDEN,
  'POST /api/inbound-letters/[id]/accept': FORBIDDEN,
  'POST /api/inbound-letters/[id]/analyze': FORBIDDEN,
  'POST /api/inbound-letters/[id]/dismiss': FORBIDDEN,
  'POST /api/inbound-letters/[id]/reply-draft': FORBIDDEN,
  'PATCH /api/inbound-letters/[id]/reply-draft': FORBIDDEN,
  'POST /api/inbound-letters/[id]/review': FORBIDDEN,
  'POST /api/inbound-letters/[id]/task/done': FORBIDDEN,
  'POST /api/inbound-letters/upload': FORBIDDEN,
  'POST /api/me/calendar': { kind: 'personal', why: 'личная ссылка на календарь сроков (CALENDAR, решение 105 — открыто эксперту явно)' },
  'DELETE /api/me/calendar': { kind: 'personal', why: 'отзыв своей ссылки на календарь (решение 105)' },
  'POST /api/me/channels/[id]/connect': { kind: 'personal', why: 'подключить свой чат уведомлений (решение 144)' },
  'DELETE /api/me/channels/[id]': { kind: 'personal', why: 'отключить свой чат уведомлений' },
  'PUT /api/me/channels': { kind: 'personal', why: 'выбрать свой основной канал уведомлений' },
  'POST /api/me/password': FORBIDDEN,
  'POST /api/me/telegram': { kind: 'personal', why: 'ссылка на привязку своего Telegram (решение 102), в базу не пишет' },
  'DELETE /api/me/telegram': { kind: 'personal', why: 'отвязать свой Telegram' },
  'PATCH /api/meetings/[id]': FORBIDDEN,
  'POST /api/meetings': FORBIDDEN,
  'POST /api/notifications/seen': { kind: 'personal', why: 'отметка «просмотрено» своего колокольчика' },
  'POST /api/portal/applications': FORBIDDEN,
  'POST /api/portal/materials/[taskId]/confirm': FORBIDDEN,
  'PATCH /api/portal/programs/[id]/metrics': FORBIDDEN,
  'POST /api/products/[id]/release': FORBIDDEN,
  'PATCH /api/products/[id]': FORBIDDEN,
  'PUT /api/products/[id]/skills': FORBIDDEN,
  'POST /api/products': FORBIDDEN,
  'POST /api/programs/[id]/archive': FORBIDDEN,
  'POST /api/programs/[id]/product-recommendations/[productId]/letter': {
    kind: 'read-only',
    why: 'черновик письма-предложения текстом, в базу — только журнал ИИ (решение 223: эксперту открыт)',
  },
  'POST /api/programs/[id]/restore': FORBIDDEN,
  'PATCH /api/programs/[id]': FORBIDDEN,
  'PUT /api/programs/[id]/skills': FORBIDDEN,
  'POST /api/programs': FORBIDDEN,
  'POST /api/recommendations/[id]/ai-letter': FORBIDDEN,
  'PATCH /api/recommendations/[id]': FORBIDDEN,
  'POST /api/recommendations/generate': FORBIDDEN,
  'POST /api/school-courses': FORBIDDEN,
  'PUT /api/settings/ai-letter-instruction': FORBIDDEN,
  'DELETE /api/settings/ai-letter-instruction': FORBIDDEN,
  'PATCH /api/settings/workflow/stages/[number]': FORBIDDEN,
  'POST /api/skills/[id]/merge': FORBIDDEN,
  'PATCH /api/skills/[id]': FORBIDDEN,
  'DELETE /api/skills/[id]': FORBIDDEN,
  'POST /api/skills': FORBIDDEN,
  'POST /api/universities/[id]/archive': FORBIDDEN,
  'POST /api/universities/[id]/contacts/[contactId]/anonymize': FORBIDDEN,
  'POST /api/universities/[id]/contacts/[contactId]/consent/withdraw': FORBIDDEN,
  'PUT /api/universities/[id]/contacts/[contactId]/legal-basis': FORBIDDEN,
  'PATCH /api/universities/[id]/responsible': FORBIDDEN,
  'POST /api/universities/[id]/restore': FORBIDDEN,
  'PATCH /api/universities/[id]': FORBIDDEN,
  'POST /api/universities/merge/[id]/undo': FORBIDDEN,
  'POST /api/universities/merge': FORBIDDEN,
  'POST /api/universities': FORBIDDEN,
  'POST /api/users/[id]/password-reset': FORBIDDEN,
  'PATCH /api/users/[id]': FORBIDDEN,
  'POST /api/users': FORBIDDEN,
  'POST /api/workflow/stages/[id]/files': FORBIDDEN,
  'PATCH /api/workflow/stages/[id]': FORBIDDEN,
  'PATCH /api/workflow/tasks/[id]': FORBIDDEN,

  'POST /api/[...unknown]': { kind: 'no-session', why: 'заглушка 404 неизвестного адреса' },
  'PUT /api/[...unknown]': { kind: 'no-session', why: 'заглушка 404 неизвестного адреса' },
  'PATCH /api/[...unknown]': { kind: 'no-session', why: 'заглушка 404 неизвестного адреса' },
  'DELETE /api/[...unknown]': { kind: 'no-session', why: 'заглушка 404 неизвестного адреса' },
  'POST /api/auth/[...nextauth]': { kind: 'no-session', why: 'вход (NextAuth)' },
  'POST /api/channels/max/webhook': { kind: 'no-session', why: 'вебхук MAX, секрет в заголовке' },
  'POST /api/channels/vk/callback': { kind: 'no-session', why: 'Callback API VK, секрет в теле' },
  'POST /api/client-errors': { kind: 'no-session', why: 'ошибки браузера в лог сервера, в базу не пишет' },
  'POST /api/import/external': { kind: 'no-session', why: 'приём извне по INTEGRATION_TOKEN, без сессии' },
  'POST /api/telegram/webhook': { kind: 'no-session', why: 'вебхук Telegram; действия кнопок проверяют права пользователя (флаг эксперта в telegram.repo)' },
}

/** Значения динамических сегментов, при которых маршрут доходит до сервиса. */
const PARAM_OVERRIDES: Record<string, Record<string, string>> = {
  // Неизвестный канал — 404 ещё в маршруте, до проверки прав.
  'POST /api/admin/channels/[id]/test': { id: 'telegram' },
  'PATCH /api/settings/workflow/stages/[number]': { number: '3' },
}

/**
 * Записи, которые маршрут читает до проверки эксперта. Без них чтение вернуло бы
 * «пусто», и ответ был бы 404, а не 403 — тест не отличил бы защиту от отсутствия
 * записи. Худший случай: эксперт сам автор и исполнитель поручения.
 */
const READ_FIXTURES: Record<string, (user: CurrentUser) => Record<string, unknown>> = {
  // Находка Codex 1: открытое задание, эксперт — его ответственный, письмо ему видно.
  // Без проверки эксперта дошло бы до inboundLetterTask.update.
  'POST /api/inbound-letters/[id]/task/done': (user) => ({
    'inboundLetter.findUnique': {
      id: 'test-id',
      status: 'CONFIRMED',
      universityId: 'uni-1',
      task: { id: 'task-1', title: 'Ответить вузу', status: 'OPEN', responsibleId: user.id, responsible: null },
    },
    'inboundLetter.count': 1,
  }),
  'PATCH /api/assignments/[id]': (user) => ({
    'assignment.findUnique': {
      id: 'test-id',
      assigneeId: user.id,
      authorId: user.id,
      text: 'Поручение',
      universityId: null,
      cooperationId: null,
      dueAt: null,
      priority: 'NORMAL',
      status: 'NEW',
      doneAt: null,
      isMock: false,
      createdAt: new Date('2026-09-28T10:00:00Z'),
      updatedAt: new Date('2026-09-28T10:00:00Z'),
      assignee: { id: user.id, fullName: user.fullName },
      author: { id: user.id, fullName: user.fullName },
      university: null,
      cooperation: null,
    },
  }),
}

// ─────────────────────────────── Поиск маршрутов ───────────────────────────────

const API_ROOT = fileURLToPath(new URL('.', import.meta.url))
const MUTATING_EXPORT = /export (?:const|async function) (POST|PUT|PATCH|DELETE)\b/g

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return routeFiles(path)
    return entry.name === 'route.ts' ? [path] : []
  })
}

interface MutatingRoute {
  key: string
  method: string
  file: string
  segments: string[]
}

const DISCOVERED: MutatingRoute[] = routeFiles(API_ROOT).flatMap((file) => {
  const dir = relative(API_ROOT, join(file, '..')).split(sep).filter(Boolean)
  const source = readFileSync(file, 'utf8')
  return [...source.matchAll(MUTATING_EXPORT)].map((match) => ({
    key: `${match[1]} /api/${dir.join('/')}`,
    method: match[1]!,
    file,
    segments: dir,
  }))
})

function paramsFor(route: MutatingRoute): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {}
  for (const segment of route.segments) {
    const catchAll = /^\[\.\.\.(\w+)\]$/.exec(segment)
    if (catchAll) {
      params[catchAll[1]!] = ['x']
      continue
    }
    const single = /^\[(\w+)\]$/.exec(segment)
    if (single) params[single[1]!] = PARAM_OVERRIDES[route.key]?.[single[1]!] ?? `test-${single[1]}`
  }
  return params
}

function urlFor(route: MutatingRoute): string {
  const params = paramsFor(route)
  const path = route.segments
    .map((segment) => {
      const name = /^\[(?:\.\.\.)?(\w+)\]$/.exec(segment)?.[1]
      if (!name) return segment
      const value = params[name]!
      return Array.isArray(value) ? value.join('/') : value
    })
    .join('/')
  return `http://localhost/api/${path}`
}

function expert(role: UserRole): CurrentUser {
  return {
    id: `expert-${role.toLowerCase()}`,
    email: `expert-${role.toLowerCase()}@skilllink.demo`,
    fullName: `Эксперт — ${role}`,
    role,
    universityId: role === 'UNIVERSITY_REP' ? 'uni-1' : null,
    isReviewer: true,
  }
}

beforeEach(() => {
  state.writes = []
  state.reads = {}
})

describe('таблица изменяющих маршрутов полная (решение 225)', () => {
  it('маршруты найдены', () => {
    expect(DISCOVERED.length).toBeGreaterThan(90)
  })

  it('каждый POST/PUT/PATCH/DELETE внесён в таблицу — новый маршрут нужно классифицировать явно', () => {
    const missing = DISCOVERED.map((route) => route.key).filter((key) => !(key in ROUTES))
    expect(missing).toEqual([])
  })

  it('в таблице нет строк без маршрута', () => {
    const found = new Set(DISCOVERED.map((route) => route.key))
    expect(Object.keys(ROUTES).filter((key) => !found.has(key))).toEqual([])
  })
})

const FORBIDDEN_ROUTES = DISCOVERED.filter((route) => ROUTES[route.key]?.kind === 'forbidden')
const EXPERT_ROLES: UserRole[] = ['ADMIN', 'HEAD', 'MANAGER', 'UNIVERSITY_REP']

describe('эксперт на изменяющих маршрутах — 403 и ни одной записи в базу (решение 225)', () => {
  it.each(FORBIDDEN_ROUTES.map((route) => [route.key, route] as const))('%s', async (_key, route) => {
    const routeModule = (await import(/* @vite-ignore */ route.file)) as Record<
      string,
      (request: Request, context: { params: Promise<Record<string, string | string[]>> }) => Promise<Response>
    >
    const handler = routeModule[route.method]!

    for (const role of EXPERT_ROLES) {
      state.user = expert(role)
      state.writes = []
      state.reads = READ_FIXTURES[route.key]?.(state.user) ?? {}
      const request = new Request(urlFor(route), {
        method: route.method,
        headers: { 'content-type': 'application/json' },
        body: route.method === 'DELETE' ? null : '{}',
      })
      const response = await handler(request, { params: Promise.resolve(paramsFor(route)) })
      const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null

      expect({ role, writes: state.writes }).toEqual({ role, writes: [] })
      expect({ role, status: response.status, code: body?.error?.code }).toEqual({ role, status: 403, code: 'FORBIDDEN' })
    }
  })
})
