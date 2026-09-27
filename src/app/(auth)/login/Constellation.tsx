'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import { TRAVEL_MS, type AssemblyTarget, type StreamAnchors } from './constellation-scene'
import type { WorkerMessage, WorkerReply } from './constellation.worker'
import styles from './login.module.css'

export { WARP_NAVIGATE_MS } from './constellation-scene'

/**
 * 3D-созвездие «Вузы × IT-компании» за экраном входа (07, раздел 31: Three.js —
 * только для необязательной картинки входа и только с запасным вариантом).
 *
 * Два скопления светящихся точек — вузы вверху слева, IT-компании под маршрутом
 * связки, между текстом и формой, — между ними тонкие связи, по связям бегут импульсы: знак SkillLink в пространстве.
 * Сцена покачивается и поворачивается за курсором; при появлении камера подлетает.
 *
 * Вход — «варп в систему» (решения 72, 75):
 * 1. звёзды всего экрана закручиваются воронкой к центру, скопления сливаются;
 * 2. всё сжимается в яркое ядро — связь установлена;
 * 3. звёзды разлетаются из ядра мимо камеры, мягкая фиолетовая вспышка;
 * 4. звёзды гаснут, а под ними по частям собирается сайт
 *    (продолжение — `.arrival` в ui/layout/Shell.module.css).
 *
 * Звёздное небо рассчитано под окно с запасом по краям: раньше пыль лежала
 * коробкой 22×12, и при нырке её края читались как отдельный квадрат.
 * Экран входа уходит на середине прыжка, поэтому холст в момент его снятия
 * переносится в `body` (под содержимое сайта) и доигрывает там, а потом гаснет
 * и освобождает ресурсы сам.
 *
 * Поток (решение 199): голова кометы — скопление вузов в верхнем левом углу,
 * связи дугой обходят текст справа и сходятся в сгусток под маршрутом связки,
 * импульсы с хвостом бегут к нему и, приходя, подсвечивают его — видно, куда
 * идёт поток.
 *
 * Сцена (constellation-scene.ts) рисуется в фоновом потоке на OffscreenCanvas
 * (constellation.worker.ts): сразу после входа браузер загружает и собирает
 * главную, и на общем потоке звёзды посреди прыжка замирали «фотографией».
 * Браузер без OffscreenCanvas получает ту же сцену на странице.
 *
 * Бережно к устройству (навык ui-ux-pro-max, раздел Three.js): библиотека
 * грузится только здесь и после показа страницы; частицы —
 * `Points` на `BufferGeometry`, ~2,4 тыс. (вдвое меньше на узком экране); плотность
 * пикселей ≤ 1,5; во скрытой вкладке кадры не считаются. «Уменьшить движение» —
 * один неподвижный кадр и вход без прыжка; нет WebGL — сцены нет.
 */

/** Сколько ядро ждёт главную, прежде чем отпустить звёзды. */
const PAGE_WAIT_MS = 10000
/**
 * Шаг между блоками: звёзды собирают экран по одному блоку. Было 150 мс — сборка
 * видимой части главной тянулась почти 2 с и читалась как подтормаживание;
 * при 90 мс порядок «меню — шапка — блоки сверху вниз» по-прежнему виден.
 */
const BLOCK_STEP_MS = 90
/**
 * Блок проявляется, пока звёзды к нему летят, и становится непрозрачным
 * (половина BLOCK_REVEAL_MS) ровно к их прилёту — звёзды гаснут уже под ним.
 */
const BLOCK_REVEAL_MS = 600
const REVEAL_LEAD_MS = BLOCK_REVEAL_MS / 2
/** Разброс вылета звёзд одного блока (SCATTER_MS в сцене) — с запасом. */
const SCATTER_ALLOWANCE_MS = 80
/**
 * Тёмная подложка экрана входа гаснет под звёздами, а не обрывается: в светлой
 * теме главная иначе вспыхивала белым в момент смены страницы (решение 199).
 */
const VEIL_FADE_MS = 700
/** Панель входа доиграла появление (panelIn: 180 + 760 мс) — её место окончательное. */
const PANEL_SETTLED_MS = 1100

/** Зазор между осью потока и текстом левой колонки (пучок шириной около 20 px и покачивается). */
const TEXT_CLEARANCE = 40
/** Зазор между осью потока (и скоплением в его конце) и формой входа. */
const FORM_CLEARANCE = 56
/** Голова кометы и конец потока не ближе этого к краям экрана. */
const EDGE_MARGIN = 96

/**
 * Куда идёт поток (решение 199). Голова кометы — выше и левее знака SkillLink,
 * у угла экрана, но не в край. Конец потока — свободное место под маршрутом
 * «Вуз — Программа — IT-продукт»: по горизонтали между правым краем текста и
 * формой (чуть ближе к форме), по вертикали на 100 px ниже маршрута. Там поток
 * заканчивается мягким скоплением и не упирается в форму. Прямая из угла туда
 * прошла бы через заголовок и абзац, поэтому поток изогнут: уходит вправо над
 * заголовком и спускается правее текста (`bend` — точка изгиба кривой). Кривая
 * проверяется по точкам: правее текста на уровне текста и левее формы везде;
 * если нет — изгиб поднимается или отходит от формы.
 * Только для раскладки в две колонки (шире 960 px); в одну колонку — null,
 * сцена как раньше.
 */
function measureAnchors(): StreamAnchors | null {
  const width = window.innerWidth
  const height = window.innerHeight
  if (width <= 960) return null
  const panel = document.querySelector<HTMLElement>(`.${styles.panel}`)
  if (!panel) return null
  const rect = (selector: string) => document.querySelector<HTMLElement>(selector)?.getBoundingClientRect() ?? null
  const form = panel.getBoundingClientRect()
  const brand = rect(`.${styles.brandRow}`)
  const text = [rect(`.${styles.headline}`), rect(`.${styles.lead}`), rect(`.${styles.map}`)].filter(
    (box): box is DOMRect => box !== null,
  )
  if (text.length === 0) return null
  const textTop = Math.min(...text.map((box) => box.top))
  const textBottom = Math.max(...text.map((box) => box.bottom))
  const textRight = Math.max(...text.map((box) => box.right))

  // Голова: левее начала знака и заметно выше него.
  const source: [number, number] = [
    Math.max(EDGE_MARGIN, Math.round((brand?.left ?? width * 0.06) + 48)),
    Math.max(EDGE_MARGIN, Math.round((brand?.top ?? height * 0.3) - 150)),
  ]
  // Конец: под маршрутом, между текстом и формой.
  const target: [number, number] = [
    // Скопление в конце потока — не ближе 90 px к форме (на 1280 зазор узкий).
    Math.round(Math.min(textRight + (form.left - textRight) * 0.55, form.left - 90)),
    Math.round(Math.max(textBottom + 40, Math.min(textBottom + 100, height - EDGE_MARGIN))),
  ]
  // Изгиб: правее конца, над заголовком.
  const bend: [number, number] = [
    Math.round(target[0] + (form.left - target[0]) * 0.5),
    Math.round(Math.max(source[1] + 20, textTop - 70)),
  ]

  /** Точка кривой source → bend → target. */
  const at = (t: number): [number, number] => {
    const u = 1 - t
    return [
      u * u * source[0] + 2 * u * t * bend[0] + t * t * target[0],
      u * u * source[1] + 2 * u * t * bend[1] + t * t * target[1],
    ]
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let hitsText = false
    let hitsForm = false
    for (let t = 0; t <= 1; t += 0.02) {
      const [x, y] = at(t)
      if (y >= textTop - TEXT_CLEARANCE / 2 && y <= textBottom && x < textRight + TEXT_CLEARANCE) hitsText = true
      if (x > form.left - FORM_CLEARANCE) hitsForm = true
    }
    if (!hitsText && !hitsForm) break
    if (hitsForm) bend[0] -= 10
    if (hitsText) bend[1] = Math.max(source[1], bend[1] - 15)
  }
  return { source, target, bend }
}

type Channel = {
  send: (message: WorkerMessage, transfer?: Transferable[]) => void
  close: () => void
}

export function Constellation() {
  const hostRef = useRef<HTMLDivElement | null>(null)
  /** Перенести холст прыжка в body — ровно в момент, когда экран входа снимается. */
  const handOffRef = useRef<(() => void) | null>(null)

  /**
   * Холст уходит в body не в момент щелчка, а когда React снимает экран входа
   * (очистка эффекта разметки идёт в том же коммите, до отрисовки). Раньше он
   * переносился сразу — под непрозрачный фон экрана входа (слой −1), и первые
   * 0,4–0,6 с прыжка экран был пуст, а звёзды появлялись уже посреди воронки:
   * это и читалось как «лаг» (решение 199).
   */
  useLayoutEffect(() => () => handOffRef.current?.(), [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    /**
     * Сенсорный экран: курсора нет — сцена не поворачивается за касаниями
     * (правило для мобилки после PR #73, пункт 2).
     */
    const touch = window.matchMedia('(hover: none)').matches
    /**
     * Сборка сайта звёздами — только на широком экране, как и обычная сборка
     * каркаса (.arrival, решение 75): на узком меню спрятано, а блоки при сборке
     * съезжали бы вбок за край экрана.
     */
    const assembles = !touch && window.matchMedia('(min-width: 1081px)').matches
    const makeCanvas = () => {
      const element = document.createElement('canvas')
      element.className = styles.sceneCanvas ?? ''
      return element
    }
    let canvas = makeCanvas()
    host.appendChild(canvas)

    const options = {
      width: window.innerWidth,
      height: window.innerHeight,
      pixelRatio: window.devicePixelRatio,
      reduced,
      narrow: window.innerWidth < 720,
      anchors: measureAnchors(),
    }

    let unmounted = false
    // Прыжок начался: холст передан сайту и уберёт себя сам.
    let handedOff = false
    let channel: Channel | null = null
    let cleanupTimer = 0
    let veil: HTMLDivElement | null = null
    let settleTimer = 0

    const onReady = () => {
      // Метка для формы входа: прыжок будет — переход на сайт ждёт пика вспышки.
      if (!reduced) document.body.dataset.warp = 'ready'
    }

    function finish() {
      window.clearTimeout(cleanupTimer)
      window.clearTimeout(readyTimer)
      window.clearTimeout(settleTimer)
      window.clearInterval(pollTimer)
      // Идущую сборку снимет её собственный таймер, когда блоки доиграют.
      if (document.body.dataset.starAssembly === 'pending') stopAssembly()
      channel?.close()
      channel = null
      canvas.remove()
      veil?.remove()
      observer.disconnect()
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      delete document.body.dataset.warp
    }

    /** Та же сцена на странице — если фоновый поток недоступен или не справился. */
    function startOnPage() {
      let frame = 0
      let scene: import('./constellation-scene').ConstellationScene | null = null
      let warping = false
      const pending: WorkerMessage[] = []
      const apply = (message: WorkerMessage) => {
        if (!scene) return void pending.push(message)
        if (message.type === 'pointer') scene.pointer(message.x, message.y)
        else if (message.type === 'resize') scene.resize(message.width, message.height)
        else if (message.type === 'anchor') scene.anchor(message.anchors, message.width, message.height)
        else if (message.type === 'warp') {
          warping = true
          scene.warp(performance.now())
        } else if (message.type === 'assemble') {
          scene.assemble(performance.now(), message.targets, message.width, message.height)
        } else if (message.type === 'release') {
          scene.release(performance.now())
        }
      }
      channel = {
        send: apply,
        close: () => {
          cancelAnimationFrame(frame)
          scene?.dispose()
          scene = null
        },
      }
      const target = canvas
      void Promise.all([import('three'), import('./constellation-scene')]).then(([THREE, module]) => {
        if ((unmounted && !handedOff) || target !== canvas) return
        scene = module.createConstellation(THREE, target, options)
        if (!scene) return finish()
        onReady()
        pending.splice(0).forEach(apply)
        if (reduced) return scene.still()
        const loop = (now: number) => {
          frame = requestAnimationFrame(loop)
          if (document.hidden && !warping) return
          if (scene?.frame(now)) finish()
        }
        frame = requestAnimationFrame(loop)
      })
    }

    /**
     * Фоновый поток не справился (нет WebGL в потоке — Safari до 17, часть сборок
     * Яндекс Браузера; поток не загрузился; молчит): его холст уже отдан потоку,
     * поэтому на его место встаёт новый, и сцена рисуется на странице. Раньше холст
     * просто снимался — и 3D на экране входа пропадал.
     */
    let readyTimer = 0
    function fallBackToPage() {
      window.clearTimeout(readyTimer)
      if (unmounted && !handedOff) return
      channel?.close()
      const replacement = makeCanvas()
      replacement.className = canvas.className
      canvas.replaceWith(replacement)
      canvas = replacement
      startOnPage()
    }

    // ── Фоновый поток, если браузер умеет; иначе — та же сцена на странице ──
    let started = false
    if (typeof Worker !== 'undefined' && 'transferControlToOffscreen' in canvas) {
      try {
        const worker = new Worker(new URL('./constellation.worker.ts', import.meta.url), { type: 'module' })
        let ready = false
        worker.onmessage = (event: MessageEvent<WorkerReply>) => {
          if (event.data.type === 'ready') {
            ready = true
            window.clearTimeout(readyTimer)
            onReady()
          } else if (event.data.type === 'unsupported') fallBackToPage()
          else if (event.data.type === 'done') finish()
        }
        worker.onerror = () => {
          if (!ready) fallBackToPage()
        }
        const offscreen = canvas.transferControlToOffscreen()
        worker.postMessage({ type: 'init', canvas: offscreen, ...options } satisfies WorkerMessage, [offscreen])
        channel = {
          send: (message) => worker.postMessage(message),
          close: () => {
            worker.postMessage({ type: 'dispose' } satisfies WorkerMessage)
            worker.terminate()
          },
        }
        // Поток молчит — не ждём дольше: сцена нужна сразу.
        readyTimer = window.setTimeout(() => {
          if (!ready) fallBackToPage()
        }, 2500)
        started = true
      } catch {
        started = false
      }
    }
    if (!started) {
      if (canvas.parentElement && 'transferControlToOffscreen' in canvas) {
        // Холст мог уйти потоку до ошибки — берём новый.
        const replacement = makeCanvas()
        canvas.replaceWith(replacement)
        canvas = replacement
      }
      startOnPage()
    }

    // ── События страницы — в сцену ─────────────────────────────────────────
    const onPointer = (event: PointerEvent) =>
      !touch &&
      channel?.send({
        type: 'pointer',
        x: event.clientX / window.innerWidth - 0.5,
        y: event.clientY / window.innerHeight - 0.5,
      })
    /** Форма встала на место или окно изменилось — концы потока считаются заново. */
    const sendAnchors = () => {
      const anchors = measureAnchors()
      if (anchors) channel?.send({ type: 'anchor', anchors, width: window.innerWidth, height: window.innerHeight })
    }
    const onResize = () => {
      channel?.send({
        type: 'resize',
        width: window.innerWidth,
        height: window.innerHeight,
      })
      sendAnchors()
    }
    settleTimer = window.setTimeout(sendAnchors, PANEL_SETTLED_MS)
    const onVisibility = () => channel?.send({ type: 'visibility', hidden: document.hidden })
    window.addEventListener('pointermove', onPointer, { passive: true })
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVisibility)
    onVisibility()

    /**
     * Прыжок: форма входа ставит `body[data-auth-leaving]`. Пока экран входа на
     * месте, звёзды летят в своём слое за колонками; когда React его снимает,
     * холст переходит в body (handOffRef) и доигрывает под сайтом. Звёзды гаснут
     * сами, собрав страницу (решение 76).
     */
    // ── Сборка главной звёздами (решение 76) ───────────────────────────────
    let pollTimer = 0
    const assembled: Animation[] = []
    const claimed: HTMLElement[] = []

    /**
     * Снять сборку: блоки остаются на местах, анимации убираются. Метка
     * `data-star-claimed` остаётся — иначе собранный звёздами блок получил бы
     * ещё и обычную сборку каркаса (`.arrival`) и прилетел бы второй раз.
     */
    function stopAssembly() {
      window.clearInterval(pollTimer)
      delete document.body.dataset.starAssembly
      assembled.forEach((animation) => animation.cancel())
      assembled.length = 0
      claimed.length = 0
    }

    /**
     * Ждём страницу: каркас, шапку и блоки. Пока ждём, они скрыты
     * (`body[data-star-assembly=pending]`), а звёзды кружат в ядре. Заготовки
     * ждём недолго: лучше собрать то, что есть, чем держать ядро.
     */
    function waitForPage() {
      document.body.dataset.starAssembly = 'pending'
      const began = performance.now()
      let pageSince: number | null = null
      pollTimer = window.setInterval(() => {
        const page = document.querySelector<HTMLElement>('[data-page]')
        const now = performance.now()
        if (!page) {
          // На локальном сервере главная при первом открытии ещё компилируется —
          // ядро кружит и ждёт. Не пришла за 10 с — звёзды разлетаются, а блоки
          // придут обычным появлением.
          if (now - began > PAGE_WAIT_MS) {
            channel?.send({ type: 'release' })
            stopAssembly()
          }
          return
        }
        pageSince ??= now
        // Данные главной: подождать, пока заготовки сменятся блоками.
        if (page.querySelector('[data-skeleton]') && now - pageSince < 1500) return
        window.clearInterval(pollTimer)
        assemble(page)
      }, 50)
    }

    /** Блоки для сборки по порядку: меню, шапка, затем сверху вниз и слева направо. */
    function assemble(page: HTMLElement) {
      const aside = document.querySelector<HTMLElement>('aside')
      const header = document.querySelector<HTMLElement>('header')
      const blocks = [
        ...Array.from(page.children).filter(
          (child): child is HTMLElement => child instanceof HTMLElement && !child.querySelector('[data-assemble]'),
        ),
        ...Array.from(page.querySelectorAll<HTMLElement>('[data-assemble]')),
      ]
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight)
        .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)

      const plan: Array<{
        element: HTMLElement
        rect: DOMRect
        delay: number
        from: string
      }> = []
      const side = (element: HTMLElement) =>
        element.dataset.assemble === 'left'
          ? 'translate3d(-70px, 40px, -200px) rotateY(18deg) rotateX(10deg)'
          : element.dataset.assemble === 'right'
            ? 'translate3d(70px, 40px, -200px) rotateY(-18deg) rotateX(10deg)'
            : 'translate3d(0, 50px, -220px) rotateX(20deg)'
      if (aside && aside.getBoundingClientRect().width > 0)
        plan.push({
          element: aside,
          rect: aside.getBoundingClientRect(),
          delay: 0,
          from: 'translateX(-50px) rotateY(32deg)',
        })
      if (header)
        plan.push({
          element: header,
          rect: header.getBoundingClientRect(),
          delay: BLOCK_STEP_MS,
          from: 'translateY(-20px) rotateX(-50deg)',
        })
      blocks.forEach(({ element, rect }, index) =>
        plan.push({
          element,
          rect,
          delay: (index + 2) * BLOCK_STEP_MS,
          from: side(element),
        }),
      )
      if (plan.length === 0) return stopAssembly()

      const targets: AssemblyTarget[] = plan.map(({ rect, delay }) => ({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        delay,
      }))
      channel?.send({
        type: 'assemble',
        targets,
        width: window.innerWidth,
        height: window.innerHeight,
      })

      // Блок проявляется из глубины, пока в него летят звёзды.
      // Только transform и opacity — их ведёт видеокарта.
      for (const { element, delay, from } of plan) {
        element.dataset.starClaimed = ''
        claimed.push(element)
        assembled.push(
          element.animate(
            [
              { opacity: 0, transform: `perspective(1200px) ${from}` },
              { opacity: 1, offset: 0.5 },
              { opacity: 1, transform: 'none' },
            ],
            {
              duration: BLOCK_REVEAL_MS,
              delay: delay + TRAVEL_MS - REVEAL_LEAD_MS,
              easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
              fill: 'both',
            },
          ),
        )
      }
      // Остальное, что придёт позже (данные главной), — обычным появлением.
      document.body.dataset.starAssembly = 'running'
      const last = Math.max(...plan.map(({ delay }) => delay))
      window.setTimeout(
        () => {
          // Блоки доиграли: снимаем анимации без скачка и сразу убираем холст —
          // звёзды к этому моменту погасли, ждать сообщения от потока незачем.
          if (document.body.dataset.starAssembly === 'running') stopAssembly()
          finish()
        },
        last + SCATTER_ALLOWANCE_MS + TRAVEL_MS - REVEAL_LEAD_MS + BLOCK_REVEAL_MS,
      )
    }

    const observer = new MutationObserver(() => {
      if (handedOff || reduced || !document.body.dataset.authLeaving || !channel) return
      handedOff = true
      handOffRef.current = () => {
        handOffRef.current = null
        // Подложка — под холстом (тот же слой, раньше в документе): звёзды поверх неё.
        const layer = document.createElement('div')
        layer.className = styles.warpVeil ?? ''
        layer.dataset.forceDark = ''
        layer.setAttribute('aria-hidden', 'true')
        document.body.appendChild(layer)
        veil = layer
        layer
          .animate([{ opacity: 1 }, { opacity: 0 }], { duration: VEIL_FADE_MS, easing: 'ease-out', fill: 'forwards' })
          .finished.then(() => layer.remove(), () => layer.remove())
        canvas.className = `${styles.sceneCanvas} ${styles.warpCanvas}`
        document.body.appendChild(canvas)
      }
      channel.send({ type: 'warp' })
      if (assembles) waitForPage()
      // Без сборки — звёзды собираются в диск и разлетаются, сайт приходит сам.
      else window.setTimeout(() => channel?.send({ type: 'release' }), 900)
      // Страховка: если сцена не сообщит об окончании, слои снимутся по времени.
      cleanupTimer = window.setTimeout(finish, PAGE_WAIT_MS + 5000)
    })
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-auth-leaving'],
    })

    return () => {
      unmounted = true
      // Прыжок идёт над сайтом — холст уберёт себя сам, когда доиграет.
      if (!handedOff) finish()
    }
  }, [])

  return <div ref={hostRef} className={styles.constellation} aria-hidden="true" />
}
