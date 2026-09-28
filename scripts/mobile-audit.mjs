#!/usr/bin/env node
/**
 * Прогон вёрстки по всем экранам на телефоне, планшете и ноутбуке (решение 219).
 *
 * Что проверяет на каждой странице:
 *   - горизонтальная прокрутка страницы: `scrollWidth` у `<html>` и `<body>` больше ширины окна;
 *   - элементы за правым (или левым) краем экрана, которые не лежат в блоке со своей прокруткой
 *     или обрезкой (у `<html>` стоит `overflow-x: clip`, поэтому вылезшее не даёт прокрутки,
 *     а просто обрезается — такие элементы и ищем);
 *   - цели нажатия меньше 44 px (только до 767 px): считается зона, а не рамка элемента —
 *     точки в 22 px от центра должны попадать в сам элемент (расширение `::after` засчитывается);
 *   - поля ввода с кеглем меньше 16 px — iOS увеличивает страницу при фокусе;
 *   - текст мельче 12 px;
 *   - нижнее меню не закрывает последние строки страницы.
 *
 * Запуск (нужен работающий сервер и демо-база с быстрым входом EXPERT_QUICK_LOGIN=true):
 *
 *   BASE_URL=http://localhost:3000 node scripts/mobile-audit.mjs
 *
 * Переменные:
 *   BASE_URL   адрес приложения (по умолчанию http://localhost:3000)
 *   ROLES      роли через запятую: manager,admin,rep — быстрый вход эксперта (только чтение);
 *              почта демо-пользователя сида (manager@skilllink.demo) — вход по паролю,
 *              чтобы проверить окна действий; пароль — в AUDIT_PASSWORD
 *   WIDTHS     ширины через запятую: 390,768,1440
 *   THEMES     dark,light
 *   MODES      showcase,work
 *   ONLY       подстрока адреса — проверить только подходящие страницы
 *   SHOTS      папка для скриншотов (не задана — без скриншотов)
 *   OUT        файл с полным отчётом в JSON
 *   PLAYWRIGHT путь к пакету playwright или playwright-core, если его нет в node_modules
 *   SCENARIOS  0 — без всплывающих слоёв; all — слои в каждой теме и режиме
 *              (по умолчанию — только в первой паре THEMES × MODES)
 *   PAGES      0 — только всплывающие слои, без обхода страниц
 *
 * Playwright в зависимости проекта не входит (решение 219): скрипт ищет его в node_modules,
 * затем в глобальной установке `@playwright/cli`. Код выхода 1 — есть страница
 * с горизонтальной прокруткой или элементом за краем.
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT,
    'playwright',
    'playwright-core',
    '/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright-core',
    '/usr/local/lib/node_modules/@playwright/cli/node_modules/playwright-core',
  ].filter(Boolean)
  for (const name of candidates) {
    try {
      return require(name)
    } catch {
      // следующий вариант
    }
  }
  console.error('Не найден Playwright. Установите его (npx playwright install chromium) или укажите PLAYWRIGHT=<путь>.')
  process.exit(2)
}

const { chromium } = loadPlaywright()

const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const list = (value, fallback) => (value ? value.split(',').map((s) => s.trim()).filter(Boolean) : fallback)
const ROLES = list(process.env.ROLES, ['manager', 'admin', 'rep'])
const WIDTHS = list(process.env.WIDTHS, ['390', '768', '1440']).map(Number)
const THEMES = list(process.env.THEMES, ['dark', 'light'])
const MODES = list(process.env.MODES, ['showcase', 'work'])
const ONLY = process.env.ONLY ?? ''
const SHOTS = process.env.SHOTS ?? ''
const OUT = process.env.OUT ?? ''
const SCENARIOS_ON = process.env.SCENARIOS !== '0'
const SCENARIO_ALL = process.env.SCENARIOS === 'all'
const PAGES_ON = process.env.PAGES !== '0'

const HEIGHTS = { 390: 844, 768: 1024, 1440: 900 }

/** Статичные экраны после входа. Карточки добавляются по первым записям из API, вход (`/login`) — отдельно, до сессии. */
const STATIC_ROUTES = [
  '/',
  '/cooperations',
  '/universities',
  '/programs',
  '/products',
  '/vendors',
  '/documents',
  '/letters',
  '/recommendations',
  '/team',
  '/reports',
  '/reports/tz',
  '/reports/catalog',
  '/reports/portfolio',
  '/analytics?tab=rating',
  '/analytics?tab=skills',
  '/analytics?tab=demand',
  '/analytics?tab=products',
  '/analytics?tab=funnel',
  '/analytics?tab=stages',
  '/analytics?tab=meetings',
  '/data-quality',
  '/approvals',
  '/import',
  '/settings',
  '/profile',
  '/profile/data',
  '/portal',
  '/help',
  '/api-docs',
  '/status',
  '/docs',
  '/privacy',
]

/** Первая запись из списка API — для карточек. */
async function firstId(request, path) {
  try {
    const response = await request.get(`${BASE_URL}${path}`)
    if (!response.ok()) return null
    const body = await response.json()
    const data = Array.isArray(body.data) ? body.data : (body.data?.items ?? [])
    return data[0]?.id ?? null
  } catch {
    return null
  }
}

async function detailRoutes(request) {
  const routes = []
  const coop = await firstId(request, '/api/cooperations?pageSize=1')
  if (coop) routes.push(`/cooperations/${coop}`)
  const uni = await firstId(request, '/api/universities?pageSize=1')
  if (uni) routes.push(`/universities/${uni}`)
  const program = await firstId(request, '/api/programs?pageSize=1')
  if (program) routes.push(`/programs/${program}`)
  const letter = await firstId(request, '/api/inbound-letters?pageSize=1')
  if (letter) routes.push(`/letters/${letter}`)
  // Карточка документа — боковая панель реестра, открывается адресом.
  const document = await firstId(request, '/api/documents?pageSize=1')
  if (document) routes.push(`/documents?document=${document}`)
  return routes
}

/**
 * Вход. Роль без «@» — быстрый вход эксперта (`manager`, `admin`, `rep`): у экспертов
 * только чтение, кнопок изменения нет. Почта — вход демо-пользователем сида
 * с паролем из AUDIT_PASSWORD: так проверяются окна действий.
 */
async function login(context, role) {
  const request = context.request
  const csrf = await (await request.get(`${BASE_URL}/api/auth/csrf`)).json()
  const byPassword = role.includes('@')
  if (byPassword && !process.env.AUDIT_PASSWORD) throw new Error(`Для входа «${role}» задайте AUDIT_PASSWORD — пароль демо-пользователей сида.`)
  const response = await request.post(`${BASE_URL}/api/auth/callback/${byPassword ? 'credentials' : 'expert'}`, {
    form: byPassword
      ? { email: role, password: process.env.AUDIT_PASSWORD, csrfToken: csrf.csrfToken, json: 'true', callbackUrl: `${BASE_URL}/` }
      : { account: role, csrfToken: csrf.csrfToken, json: 'true', callbackUrl: `${BASE_URL}/` },
  })
  if (response.status() >= 400) throw new Error(`Быстрый вход «${role}» не прошёл: ${response.status()}`)
  const me = await request.get(`${BASE_URL}/api/me`)
  if (!me.ok()) throw new Error(`После входа «${role}» /api/me ответил ${me.status()} — включён ли EXPERT_QUICK_LOGIN?`)
}

/** Замер внутри страницы. Возвращает найденное. */
function measure({ mobile }) {
  const vw = window.innerWidth
  const doc = document.documentElement
  const result = {
    scrollWidth: Math.max(doc.scrollWidth, document.body.scrollWidth),
    innerWidth: vw,
    offenders: [],
    smallTargets: [],
    smallInputs: [],
    tinyText: [],
    tabBarOverlap: null,
  }

  const describe = (el) => {
    const id = el.id ? `#${el.id}` : ''
    const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''
    const text = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)
    return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` «${text}»` : ''}`
  }
  const visible = (el, rect) => {
    if (rect.width === 0 || rect.height === 0) return false
    const style = getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none'
  }
  /** Лежит ли элемент в блоке, который сам обрезает или прокручивает содержимое по горизонтали. */
  const clippedByAncestor = (el) => {
    for (let node = el.parentElement; node && node !== document.body && node !== doc; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.overflowX !== 'visible') return true
      if (style.position === 'fixed') return false
    }
    return false
  }

  const all = document.body.querySelectorAll('*')
  for (const el of all) {
    if (el.closest('[aria-hidden="true"], svg, [data-audit-ignore]')) continue
    const rect = el.getBoundingClientRect()
    if (!visible(el, rect)) continue
    if ((rect.right > vw + 1 || rect.left < -1) && !clippedByAncestor(el)) {
      // В отчёт — только самый внешний вылезший элемент.
      const parent = el.parentElement
      const parentRect = parent?.getBoundingClientRect()
      const parentOut = parentRect && (parentRect.right > vw + 1 || parentRect.left < -1) && !clippedByAncestor(parent)
      if (!parentOut) {
        result.offenders.push({ el: describe(el), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) })
      }
    }
  }

  if (mobile) {
    const targets = document.body.querySelectorAll(
      'a[href], button, [role="button"], [role="tab"], [role="menuitem"], [role="switch"], [role="checkbox"], summary, input:not([type="hidden"]), select, textarea',
    )
    for (const el of targets) {
      if (el.closest('[aria-hidden="true"], [inert], [data-audit-ignore]')) continue
      if (el.disabled) continue
      const rect = el.getBoundingClientRect()
      if (!visible(el, rect)) continue
      const style = getComputedStyle(el)
      // Невидимое до наведения (якорь «#» у заголовка) пальцем не ищут.
      if (parseFloat(style.opacity) === 0) continue
      // Ссылка внутри абзаца — исключение WCAG 2.5.8: её размер задаёт строка текста.
      if (el.tagName === 'A' && style.display === 'inline' && el.parentElement && getComputedStyle(el.parentElement).display !== 'flex') {
        const parentText = el.parentElement.textContent?.trim() ?? ''
        if (parentText.length > (el.textContent?.trim().length ?? 0) + 8) continue
      }
      if (['checkbox', 'radio'].includes(el.getAttribute('type') ?? '')) {
        // Флажок обычно нажимается через подпись.
        if (el.closest('label')) continue
      }
      const tall = rect.height >= 43.5
      const wide = rect.width >= 43.5
      if (tall && wide) continue
      // Зона шире рамки: проверяем точки в 22 px от центра.
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const hits = (x, y) => {
        if (x < 0 || y < 0 || x > vw || y > window.innerHeight) return false
        const hit = document.elementFromPoint(x, y)
        return !!hit && (hit === el || el.contains(hit))
      }
      // Закрыто окном или панелью поверх — сейчас это не цель нажатия.
      if (!hits(cx, cy)) continue
      const zoneTall = tall || (hits(cx, cy - 21) && hits(cx, cy + 21))
      const zoneWide = wide || (hits(cx - 21, cy) && hits(cx + 21, cy))
      if (!zoneTall || !zoneWide) {
        result.smallTargets.push({ el: describe(el), w: Math.round(r.width), h: Math.round(r.height) })
      }
    }
    window.scrollTo(0, 0)

    for (const el of document.body.querySelectorAll('input, select, textarea')) {
      const type = el.getAttribute('type') ?? ''
      if (['checkbox', 'radio', 'range', 'hidden', 'file', 'color', 'submit', 'button'].includes(type)) continue
      const rect = el.getBoundingClientRect()
      if (!visible(el, rect)) continue
      const size = parseFloat(getComputedStyle(el).fontSize)
      if (size < 16) result.smallInputs.push({ el: describe(el), fontSize: size })
    }
  }

  const tiny = new Map()
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue
    const el = node.parentElement
    if (!el || el.closest('[aria-hidden="true"], svg, [data-audit-ignore], script, style, noscript')) continue
    const rect = el.getBoundingClientRect()
    if (!visible(el, rect)) continue
    const size = parseFloat(getComputedStyle(el).fontSize)
    if (size < 12) {
      const key = `${size}px ${describe(el)}`
      tiny.set(key, (tiny.get(key) ?? 0) + 1)
    }
  }
  result.tinyText = [...tiny.keys()].slice(0, 12)

  // Нижнее меню: последний элемент содержимого не должен уходить под него.
  const tabBar = [...document.querySelectorAll('nav')].find((nav) => {
    const style = getComputedStyle(nav)
    const rect = nav.getBoundingClientRect()
    return style.position === 'fixed' && rect.bottom >= window.innerHeight - 2 && rect.height > 0 && rect.height < 140
  })
  if (tabBar) {
    window.scrollTo(0, doc.scrollHeight)
    const barTop = tabBar.getBoundingClientRect().top
    const main = document.querySelector('main') ?? document.body
    let lastBottom = 0
    let last = null
    for (const el of main.querySelectorAll('*')) {
      const rect = el.getBoundingClientRect()
      if (!visible(el, rect) || rect.height === 0) continue
      if (el.closest('[aria-hidden="true"]')) continue
      if (getComputedStyle(el).position === 'fixed') continue
      if (!el.textContent?.trim() && !['BUTTON', 'A', 'INPUT'].includes(el.tagName)) continue
      if (rect.bottom > lastBottom) {
        lastBottom = rect.bottom
        last = el
      }
    }
    if (last && lastBottom > barTop + 1) {
      result.tabBarOverlap = { el: describe(last), bottom: Math.round(lastBottom), barTop: Math.round(barTop) }
    }
    window.scrollTo(0, 0)
  }

  return result
}

/**
 * Всплывающие слои: поиск, колокольчик, меню, «?», окна действий, панели.
 * `open` — шаги до открытия: `button` — кнопка по доступному имени (регулярное
 * выражение), `css` — селектор, `type` — ввод текста в поле с фокусом.
 * Нет кнопки у этой роли или на этой ширине — сценарий пропускается.
 */
const SCENARIOS = [
  { name: 'поиск ⌘K', route: '/', open: [{ css: '[data-search-trigger]' }, { type: 'мт' }] },
  { name: 'колокольчик', route: '/', open: [{ button: /^Уведомления/ }] },
  { name: 'меню профиля', route: '/', open: [{ button: /^Профиль:/ }] },
  { name: 'боковое меню', route: '/', maxWidth: 1080, open: [{ button: /^Открыть меню$/ }] },
  { name: 'меню «Ещё»', route: '/', minWidth: 768, open: [{ button: /^Ещё/ }] },
  { name: '«?» у заголовка', route: '/cooperations', open: [{ button: /^Что такое/ }] },
  { name: '«?» на главной', route: '/', open: [{ button: /^Что такое/, nth: 3 }] },
  { name: 'список «Статус»', route: '/cooperations', open: [{ css: 'button[aria-haspopup="listbox"]' }] },
  { name: 'окно «Создать связку»', route: '/cooperations', open: [{ button: /^Создать связку/ }] },
  { name: 'окно «Добавить вуз»', route: '/universities', open: [{ button: /^Добавить вуз/ }] },
  { name: 'панель сотрудника', route: '/team', open: [{ button: /^Открыть сотрудника/ }] },
  { name: 'окно поручения', route: '/team', open: [{ button: /^Дать поручение/ }] },
  { name: 'окно «Сменить статус» связки', route: 'coop', open: [{ button: /^Сменить статус/ }] },
  { name: 'окно ответственного связки', route: 'coop', open: [{ button: /ответственн/i }] },
  { name: 'чек-лист этапа', route: 'coop', open: [{ css: '[role="button"][aria-expanded="false"]' }] },
  { name: 'окно «Добавить документ»', route: 'coop', open: [{ tab: /^Документы/ }, { button: /^Добавить документ/ }] },
  { name: 'окно «Изменить» пользователя', route: '/settings#users', open: [{ button: /^Изменить$/ }] },
  { name: 'окно «Завести пользователя»', route: '/settings#users', open: [{ button: /Завести пользователя/ }] },
]

/** Замер открытого слоя: не за краем, не выше экрана без прокрутки, цели под палец. */
function measureOverlay({ mobile }) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const problems = []
  const describe = (el) => {
    const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : ''
    const text = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30)
    return `${el.tagName.toLowerCase()}${cls}${text ? ` «${text}»` : ''}`
  }
  const layers = [...document.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"], [data-floating-layer], aside')].filter((el) => {
    const r = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  })
  const scrollable = (el) => {
    for (const node of [el, ...el.querySelectorAll('*')]) {
      const style = getComputedStyle(node)
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) return true
    }
    return false
  }
  for (const el of layers) {
    const r = el.getBoundingClientRect()
    if (r.left < -1 || r.right > vw + 1) problems.push(`за краем по горизонтали: ${describe(el)} ${Math.round(r.left)}…${Math.round(r.right)}`)
    if (r.top < -1) problems.push(`выше верхнего края: ${describe(el)} top=${Math.round(r.top)}`)
    if (r.bottom > vh + 1 && getComputedStyle(el).position === 'fixed' && !scrollable(el)) {
      problems.push(`ниже экрана без прокрутки: ${describe(el)} bottom=${Math.round(r.bottom)}`)
    }
    for (const child of el.querySelectorAll('*')) {
      const c = child.getBoundingClientRect()
      if (!c.width || !c.height) continue
      if (c.right > vw + 1 || c.left < -1) {
        let clipped = false
        for (let node = child.parentElement; node && node !== el.parentElement; node = node.parentElement) {
          if (getComputedStyle(node).overflowX !== 'visible') { clipped = true; break }
        }
        if (!clipped) { problems.push(`внутри слоя за краем: ${describe(child)}`); break }
      }
    }
    if (mobile) {
      for (const t of el.querySelectorAll('a[href], button, [role="option"], [role="menuitem"], input:not([type="hidden"]), select, textarea')) {
        const tr = t.getBoundingClientRect()
        if (!tr.width || !tr.height || tr.bottom < 0 || tr.top > vh) continue
        if (['checkbox', 'radio'].includes(t.getAttribute('type') ?? '') && t.closest('label')) continue
        if (tr.height >= 43.5 && tr.width >= 43.5) continue
        const cx = tr.left + tr.width / 2
        const cy = tr.top + tr.height / 2
        const hits = (x, y) => {
          const hit = document.elementFromPoint(x, y)
          return !!hit && (hit === t || t.contains(hit))
        }
        const ok = (tr.height >= 43.5 || (hits(cx, cy - 21) && hits(cx, cy + 21))) && (tr.width >= 43.5 || (hits(cx - 21, cy) && hits(cx + 21, cy)))
        if (!ok) problems.push(`мелкая цель: ${describe(t)} ${Math.round(tr.width)}×${Math.round(tr.height)}`)
      }
    }
  }
  const html = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
  if (html > vw + 1) problems.push(`прокрутка страницы ${html}>${vw}`)
  return { layers: layers.map(describe), problems: [...new Set(problems)] }
}

async function runStep(page, step) {
  if (step.type) {
    await page.keyboard.type(step.type)
    return true
  }
  const locator = step.css
    ? page.locator(step.css)
    : step.tab
      ? page.getByRole('tab', { name: step.tab })
      : page.getByRole('button', { name: step.button })
  const target = locator.nth(step.nth ?? 0)
  // Кнопки из данных (список пользователей, строки) появляются после ответа API.
  try {
    await target.waitFor({ state: 'visible', timeout: 4000 })
  } catch {
    return false
  }
  await target.scrollIntoViewIfNeeded()
  await target.click()
  return true
}

/** Переход с одной повторной попыткой: первый заход на страницу сервера разработки долго собирается. */
async function open(page, url) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
      return true
    } catch (error) {
      if (attempt === 1) {
        console.log(`! ${url} не открылась: ${error.message.split('\n')[0]}`)
        return false
      }
    }
  }
  return false
}

async function settle(page) {
  // Не networkidle: на главной и в шапке есть периодические запросы, и ожидание
  // тишины в сети съедало по 12 секунд на страницу.
  try {
    await page.waitForLoadState('load', { timeout: 20000 })
  } catch {
    // долгая загрузка — меряем как есть
  }
  // Скелетоны и заставка.
  try {
    await page.waitForFunction(
      () => !document.querySelector('[aria-busy="true"], [class*="Skeleton_skeleton"]'),
      null,
      { timeout: 8000 },
    )
  } catch {
    // остались — всё равно меряем
  }
  await page.waitForTimeout(900)
}

async function main() {
  const browser = await chromium.launch()
  const report = []
  let failed = 0
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })

  for (const role of ROLES) {
    for (const width of WIDTHS) {
      for (const theme of THEMES) {
        for (const mode of MODES) {
          const mobile = width < 768
          const context = await browser.newContext({
            viewport: { width, height: HEIGHTS[width] ?? 900 },
            deviceScaleFactor: 1,
            isMobile: mobile,
            hasTouch: mobile,
            colorScheme: theme,
            locale: 'ru-RU',
          })
          await context.addInitScript(
            ({ theme, mode }) => {
              try {
                localStorage.setItem('skilllink.theme', theme)
                localStorage.setItem('skilllink.uiMode.v2', mode)
                sessionStorage.setItem('skilllink_splash_seen', '1')
              } catch {
                // приватное окно
              }
            },
            { theme, mode },
          )
          const page = await context.newPage()
          // Вход — до сессии, один раз на ширину, тему и режим (у первой роли).
          if (PAGES_ON && role === ROLES[0] && '/login'.includes(ONLY)) {
            if (await open(page, `${BASE_URL}/login`)) {
              await settle(page)
              if (SHOTS) await page.screenshot({ path: join(SHOTS, `guest-${width}-${theme}-${mode}-login.png`), fullPage: true })
              const m = await page.evaluate(measure, { mobile })
              const horizontal = m.scrollWidth > m.innerWidth + 1
              if (horizontal || m.offenders.length) failed += 1
              report.push({ role: 'guest', width, theme, mode, route: '/login', horizontal, ...m })
              console.log(`${horizontal || m.offenders.length ? '✗' : '✓'} guest ${width} ${theme} ${mode} /login${m.offenders.length ? ` — за краем: ${m.offenders.length}` : ''}${m.smallTargets.length ? ` — мелкие цели: ${m.smallTargets.length}` : ''}`)
            }
          }
          await login(context, role)
          const routes = [...STATIC_ROUTES, ...(await detailRoutes(context.request))].filter((r) => r.includes(ONLY))
          const errors = []
          page.on('pageerror', (error) => errors.push(error.message))
          for (const route of PAGES_ON ? routes : []) {
            const consoleErrors = []
            const onConsole = (msg) => {
              if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 160))
            }
            page.on('console', onConsole)
            if (!(await open(page, `${BASE_URL}${route}`))) {
              page.off('console', onConsole)
              failed += 1
              continue
            }
            await settle(page)
            // Снимок — до замера: замер листает полосы с прокруткой, чтобы проверить зоны нажатия.
            if (SHOTS) {
              const name = `${role}-${width}-${theme}-${mode}-${route.replace(/[/?=&]+/g, '_').replace(/^_|_$/g, '') || 'home'}.png`
              await page.screenshot({ path: join(SHOTS, name), fullPage: true })
            }
            const m = await page.evaluate(measure, { mobile })
            page.off('console', onConsole)
            const horizontal = m.scrollWidth > m.innerWidth + 1
            const bad = horizontal || m.offenders.length > 0
            if (bad) failed += 1
            const entry = { role, width, theme, mode, route, finalUrl: page.url().replace(BASE_URL, ''), horizontal, ...m, consoleErrors }
            report.push(entry)
            const flags = [
              horizontal ? `ПРОКРУТКА ${m.scrollWidth}>${m.innerWidth}` : '',
              m.offenders.length ? `за краем: ${m.offenders.length}` : '',
              m.smallTargets.length ? `мелкие цели: ${m.smallTargets.length}` : '',
              m.smallInputs.length ? `поля <16px: ${m.smallInputs.length}` : '',
              m.tinyText.length ? `текст <12px: ${m.tinyText.length}` : '',
              m.tabBarOverlap ? 'под нижним меню' : '',
              consoleErrors.length ? `консоль: ${consoleErrors.length}` : '',
            ].filter(Boolean)
            console.log(`${bad ? '✗' : '✓'} ${role} ${width} ${theme} ${mode} ${route}${flags.length ? ` — ${flags.join(', ')}` : ''}`)
          }
          if (SCENARIOS_ON && (SCENARIO_ALL || (theme === THEMES[0] && mode === MODES[0]))) {
            const coop = routes.find((r) => r.startsWith('/cooperations/'))
            for (const scenario of SCENARIOS) {
              if (scenario.maxWidth && width > scenario.maxWidth) continue
              if (scenario.minWidth && width < scenario.minWidth) continue
              const route = scenario.route === 'coop' ? coop : scenario.route
              if (!route || !route.includes(ONLY)) continue
              // Тот же адрес с «#» браузер не перезагружает — окно прошлого сценария осталось бы открытым.
              await page.goto('about:blank')
              if (!(await open(page, `${BASE_URL}${route}`))) {
                failed += 1
                continue
              }
              await settle(page)
              // Шапка и кнопки появляются после гидратации.
              await page.waitForTimeout(600)
              let opened = true
              for (const step of scenario.open) {
                opened = await runStep(page, step).catch(() => false)
                if (!opened) break
                await page.waitForTimeout(700)
              }
              if (!opened) {
                console.log(`· ${role} ${width} ${theme} ${mode} [${scenario.name}] — нет у этой роли или на этой ширине`)
                continue
              }
              const o = await page.evaluate(measureOverlay, { mobile })
              if (SHOTS) {
                const name = `${role}-${width}-${theme}-${mode}-слой-${scenario.name.replace(/[^а-яёa-z0-9]+/gi, '_')}.png`
                await page.screenshot({ path: join(SHOTS, name) })
              }
              const bad = o.problems.some((p) => !p.startsWith('мелкая цель'))
              if (bad) failed += 1
              report.push({ role, width, theme, mode, route, scenario: scenario.name, ...o })
              console.log(`${bad ? '✗' : '✓'} ${role} ${width} ${theme} ${mode} [${scenario.name}]${o.problems.length ? ` — ${o.problems.join('; ')}` : ''}`)
            }
          }
          await context.close()
        }
      }
    }
  }
  await browser.close()

  if (OUT) {
    const dir = OUT.replace(/\/[^/]*$/, '')
    if (dir && dir !== OUT && !existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(OUT, JSON.stringify(report, null, 2))
  }
  const total = report.length
  console.log(`\nПроверено страниц и слоёв: ${total}. С горизонтальной прокруткой, элементом за краем или слоем выше экрана: ${failed}.`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
