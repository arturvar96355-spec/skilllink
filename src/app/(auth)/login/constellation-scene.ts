import type * as ThreeModule from 'three'

/**
 * Сцена 3D-созвездия входа (решения 71, 72, 75) — без DOM.
 *
 * Работает и в фоновом потоке (constellation.worker.ts, OffscreenCanvas), и на
 * странице как запасной вариант: сцена получает холст и размеры, а события
 * курсора, окна и начало прыжка ей передаёт владелец (Constellation.tsx).
 *
 * В фоновом потоке кадры идут, даже пока страница занята: сразу после входа
 * браузер загружает и собирает главную, и на общем потоке звёзды замирали
 * «фотографией» посреди прыжка.
 */

type Three = typeof ThreeModule

const LINKS = 28
const BRAND_VIOLET = 0x8e6cff
const BRAND_PINK = 0xed5aa7
const LIGHT = 0xf3f1ed

/**
 * Когда экран входа меняется на сайт: на середине воронки. Страница под звёздами
 * скрыта до сборки (решение 76), а чем раньше она начнёт открываться, тем меньше
 * ядру ждать.
 */
export const WARP_NAVIGATE_MS = 600
/** Воронка: к этому моменту звёзды собрались в ядро (мс от начала прыжка). */
const GATHER_MS = 920
/** Скопления и связи растворяются в ядре. */
const DISSOLVE_FROM_MS = 700
const DISSOLVE_MS = 500
/** Разгон вращения в начале прыжка: скорость растёт плавно, без рывка. */
const SPIN_UP_MS = 350
/**
 * Дольше ядро страницу не ждёт само: владелец сцены обычно раньше решает, что
 * страница не придёт, и отпускает звёзды (`release`) — они разлетаются мимо камеры.
 */
const HOLD_LIMIT_MS = 10000
const BURST_MS = 800
/** Полёт звезды из ядра к контуру блока… */
export const TRAVEL_MS = 700
/**
 * …и угасание на подлёте: звезда «вливается» в блок и гаснет ровно к касанию —
 * на прозрачных частях блока (заголовки колонок) ей не на чем задерживаться. Звёзды на контуре блока (так было сначала) пунктиром
 * висели на прозрачных частях страницы — заголовке, рамках колонок — и читались
 * как след; теперь они ложатся внутрь блока и на месте не задерживаются.
 */
const ABSORB_LEAD_MS = 180
const ABSORB_MS = 180
/** Разброс вылета звёзд одного блока. */
const SCATTER_MS = 60

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeIn = (t: number) => t * t * t

/** Точка с нормальным разбросом вокруг центра — скопление плотное в середине. */
function gaussian(): number {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export interface SceneOptions {
  width: number
  height: number
  pixelRatio: number
  reduced: boolean
  narrow: boolean
}

/** Блок страницы, который собирают звёзды: прямоугольник на экране, пиксели. */
export interface AssemblyTarget {
  x: number
  y: number
  width: number
  height: number
  /** Через сколько миллисекунд звёзды вылетают к блоку. */
  delay: number
}

export interface ConstellationScene {
  /** Курсор, доли экрана от −0,5 до 0,5. */
  pointer(x: number, y: number): void
  resize(width: number, height: number): void
  /** Начать прыжок. */
  warp(now: number): void
  /** Страница открылась: звёзды из ядра летят к её блокам (решение 76). */
  assemble(now: number, targets: AssemblyTarget[], width: number, height: number): void
  /** Страница не пришла: звёзды разлетаются мимо камеры. */
  release(now: number): void
  /** Нарисовать кадр; true — прыжок доигран, сцену пора освободить. */
  frame(now: number): boolean
  /** Один неподвижный кадр («уменьшить движение»). */
  still(): void
  dispose(): void
}

/** null — WebGL недоступен. */
export function createConstellation(
  THREE: Three,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: SceneOptions,
): ConstellationScene | null {
  const { reduced, narrow } = options
  const scale = narrow ? 0.5 : 1

  let renderer: InstanceType<Three['WebGLRenderer']>
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: true,
      powerPreference: 'low-power',
    })
  } catch {
    return null
  }
  renderer.setPixelRatio(Math.min(options.pixelRatio, 1.5))
  // false — размер элемента задаёт CSS; у OffscreenCanvas стиля нет вовсе.
  renderer.setSize(options.width, options.height, false)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(55, options.width / options.height, 0.1, 100)
  camera.position.set(0, 0, reduced ? 14 : 26)

  const world = new THREE.Group()
  // Скопления — в пустых углах экрана, связи — по диагонали через свободную
  // середину: ни заголовок, ни форму сцена не пересекает.
  world.position.set(0, 0, -1.5)
  scene.add(world)

  // Мягкая круглая точка: текстура рисуется один раз на холсте.
  // В фоновом потоке документа нет — точка рисуется на OffscreenCanvas.
  const dotCanvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(64, 64)
      : Object.assign(document.createElement('canvas'), {
          width: 64,
          height: 64,
        })
  const ctx = dotCanvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (ctx) {
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 64, 64)
  }
  const dot = new THREE.CanvasTexture(dotCanvas)
  const pointsMaterial = (size: number, extra: Record<string, unknown> = {}) =>
    new THREE.PointsMaterial({
      size,
      map: dot,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      ...extra,
    })

  const hubs = [
    {
      home: new THREE.Vector3(narrow ? -2.4 : -6.2, narrow ? 4.2 : 3.6, 0),
      from: new THREE.Color(LIGHT),
      to: new THREE.Color(BRAND_VIOLET),
      core: LIGHT,
    },
    {
      home: new THREE.Vector3(narrow ? 2.4 : 7.4, narrow ? -4.2 : -4.6, -0.6),
      from: new THREE.Color(BRAND_VIOLET),
      to: new THREE.Color(BRAND_PINK),
      core: BRAND_VIOLET,
    },
  ]

  // ── Скопления: у каждого своя группа — их можно свести вместе ──────────
  const clusterSize = Math.round(900 * scale)
  const color = new THREE.Color()
  const geometries: Array<InstanceType<typeof THREE.BufferGeometry>> = []
  const clusterMaterial = pointsMaterial(0.11, { vertexColors: true })
  const coreMaterial = pointsMaterial(1.4, { vertexColors: true })
  const clusters = hubs.map((hub) => {
    const group = new THREE.Group()
    group.position.copy(hub.home)
    world.add(group)

    const positions = new Float32Array(clusterSize * 3)
    const colors = new Float32Array(clusterSize * 3)
    const anchors: Array<InstanceType<typeof THREE.Vector3>> = []
    for (let i = 0; i < clusterSize; i += 1) {
      const x = gaussian() * 1.5
      const y = gaussian() * 1.15
      const z = gaussian() * 1.5
      positions.set([x, y, z], i * 3)
      const t = Math.min(1, Math.hypot(x, y, z) / 2.4)
      color
        .copy(hub.from)
        .lerp(hub.to, t)
        .multiplyScalar(0.75 + 0.5 * (1 - t))
      colors.set([color.r, color.g, color.b], i * 3)
      // Ядро скопления — концы связей.
      if (t < 0.35 && anchors.length < 120) anchors.push(new THREE.Vector3(x, y, z))
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    group.add(new THREE.Points(geometry, clusterMaterial))

    // Центр скопления — одна из двух точек знака SkillLink.
    const core = new THREE.BufferGeometry()
    core.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3))
    core.setAttribute('color', new THREE.BufferAttribute(new Float32Array(new THREE.Color(hub.core).toArray()), 3))
    group.add(new THREE.Points(core, coreMaterial))
    geometries.push(geometry, core)
    return { group, anchors, home: hub.home }
  })

  // ── Звёздное небо — во весь экран, с запасом по краям ────────────────
  // Звёзды лежат в сцене, а не в покачивающемся мире: небо не съезжает с экрана.
  // Размах — по видимой области с дальней точки подлёта камеры (z = 26),
  // поэтому края неба не видны ни в начале, ни в прыжке.
  const skySize = Math.round(1500 * scale)
  const skyHome = new Float32Array(skySize * 3)
  const skyPositions = new Float32Array(skySize * 3)
  /**
   * Цвет звезды неба с прозрачностью (rgba): гаснущая звезда теряет и свет,
   * и непрозрачность. Когда гас только цвет, погасшая звезда оставалась в холсте
   * непрозрачной и закрывала фон тёмной точкой — «след» в конце сборки. Звёзды
   * без непрозрачности совсем (только свет) не годятся: обычный Chrome на Mac
   * такие пиксели холста не показывает, и 3D на экране входа пропадал.
   */
  const skyColors = new Float32Array(skySize * 4)
  const skyBase = new Float32Array(skySize * 3)
  const skySpin = new Float32Array(skySize)
  const skyReach = new Float32Array(skySize)
  const halfTan = Math.tan((55 / 2) * (Math.PI / 180))
  const aspect = options.width / options.height
  for (let i = 0; i < skySize; i += 1) {
    const z = -14 + Math.random() * 18
    const halfH = (26 - z) * halfTan * 1.15
    const halfW = halfH * aspect
    skyHome.set([(Math.random() * 2 - 1) * halfW, (Math.random() * 2 - 1) * halfH, z], i * 3)
    color.set(Math.random() < 0.2 ? BRAND_PINK : BRAND_VIOLET).multiplyScalar(0.3 + Math.random() * 0.45)
    if (Math.random() < 0.12) color.set(LIGHT).multiplyScalar(0.55)
    skyBase.set([color.r, color.g, color.b], i * 3)
    skyColors.set([color.r, color.g, color.b, 1], i * 4)
    skySpin[i] = 1.6 + Math.random() * 1.4
    skyReach[i] = 0.7 + Math.random() * 0.8
  }
  skyPositions.set(skyHome)
  const skyGeometry = new THREE.BufferGeometry()
  skyGeometry.setAttribute('position', new THREE.BufferAttribute(skyPositions, 3))
  skyGeometry.setAttribute('color', new THREE.BufferAttribute(skyColors, 4))
  const fieldMaterial = pointsMaterial(0.11, { vertexColors: true })
  const field = new THREE.Points(skyGeometry, fieldMaterial)
  scene.add(field)
  geometries.push(skyGeometry)

  /**
   * Звезда в воронке. Собираются не в точку, а в наклонный звёздный диск: у каждой
   * свой радиус в диске и своя скорость (внутренние быстрее, как у галактики).
   * Угол растёт с плавным разгоном с самого начала прыжка, радиус сжимается
   * плавно — скорость нигде не прыгает, и диск всё время заметно вращается.
   * `burst` — запасной разлёт мимо камеры.
   */
  const diskRadius = new Float32Array(skySize)
  const diskSpeed = new Float32Array(skySize)
  for (let i = 0; i < skySize; i += 1) {
    const reach = (skyReach[i]! - 0.7) / 0.8
    // До самого центра: пустой круг посередине читался как тёмный провал.
    diskRadius[i] = 0.08 + 3.8 * Math.pow(reach, 1.6)
    diskSpeed[i] = 0.0009 + 0.0021 * (1 - reach)
  }
  const DISK_TILT = 0.45
  const swirl = (i: number, t: number, gather: number, burst: number, time: number, out: Float32Array) => {
    const hx = skyHome[i * 3]!
    const hy = skyHome[i * 3 + 1]!
    const hz = skyHome[i * 3 + 2]!
    const home = Math.hypot(hx, hy)
    const spun = t - SPIN_UP_MS * (1 - Math.exp(-t / SPIN_UP_MS))
    const angle = Math.atan2(hy, hx) + time * 0.012 + diskSpeed[i]! * spun
    const r = home + (diskRadius[i]! - home) * gather + burst * burst * 26 * skyReach[i]!
    const x = Math.cos(angle) * r
    const y = Math.sin(angle) * r
    const wobble = Math.sin(angle * 2 + i) * 0.25 * gather
    // Диск наклонён к зрителю — видно, что он объёмный и вращается.
    const tilt = DISK_TILT * gather
    out[0] = x
    out[1] = y * Math.cos(tilt)
    out[2] = hz * (1 - gather) + y * Math.sin(tilt) + wobble + burst * (9 + 7 * skyReach[i]!)
  }

  // ── Сборка страницы звёздами ────────────────────────────────────────────
  /** Куда летит каждая звезда (мировые координаты) и когда вылетает. */
  const skyTarget = new Float32Array(skySize * 3)
  /** Центр блока звезды: звёзды летят к блоку струёй через его центр и там расходятся. */
  const skyVia = new Float32Array(skySize * 2)
  const skyDelay = new Float32Array(skySize)
  let assembleAt: number | null = null
  let assemblyEnd = 0
  let releaseAt: number | null = null

  /** Точка внутри блока, с отступом от краёв — пиксели экрана. */
  const pointIn = (target: AssemblyTarget): [number, number] => {
    const { x, y, width: w, height: h } = target
    const inset = Math.min(12, w / 4, h / 4)
    return [x + inset + Math.random() * (w - 2 * inset), y + inset + Math.random() * (h - 2 * inset)]
  }

  const planTargets = (targets: AssemblyTarget[], screenW: number, screenH: number, cameraZ: number) => {
    // Экран → плоскость z = 0 сцены, как её видит камера.
    const halfH = cameraZ * Math.tan((55 / 2) * (Math.PI / 180))
    const halfW = halfH * (screenW / screenH)
    // Звёзд блоку — по площади, но меню во всю высоту не забирает себе половину.
    const weights = targets.map((t) => Math.min(Math.sqrt(t.width * t.height), 700))
    const total = weights.reduce((sum, w) => sum + w, 0) || 1
    let latest = 0
    for (let i = 0; i < skySize; i += 1) {
      let pick = Math.random() * total
      let index = 0
      while (index < targets.length - 1 && pick > weights[index]!) pick -= weights[index++]!
      const target = targets[index]!
      const [px, py] = pointIn(target)
      skyTarget[i * 3] = (px / screenW) * 2 * halfW - halfW
      skyTarget[i * 3 + 1] = halfH - (py / screenH) * 2 * halfH
      skyTarget[i * 3 + 2] = 0
      skyVia[i * 2] = ((target.x + target.width / 2) / screenW) * 2 * halfW - halfW
      skyVia[i * 2 + 1] = halfH - ((target.y + target.height / 2) / screenH) * 2 * halfH
      skyDelay[i] = target.delay + Math.random() * SCATTER_MS
      latest = Math.max(latest, skyDelay[i]!)
    }
    return latest + TRAVEL_MS - ABSORB_LEAD_MS + ABSORB_MS
  }

  const point = new Float32Array(3)
  /**
   * Звёзды неба за кадр. До сборки — воронка и вращающийся диск; в сборке каждая
   * звезда со своей задержкой уходит из диска в свой блок по дуге навстречу
   * камере и гаснет на прилёте — блок к этому моменту уже проявился.
   */
  const updateSky = (t: number, gather: number, burst: number, time: number) => {
    for (let i = 0; i < skySize; i += 1) {
      swirl(i, t, gather, burst, time, point)
      let glow = 1
      let bright = 1
      if (assembleAt !== null) {
        const local = t - assembleAt - skyDelay[i]!
        const p = clamp01(local / TRAVEL_MS)
        const e = easeInOut(p)
        // Кривая через центр блока: звёзды одного блока летят вместе и
        // расходятся по нему только на подлёте.
        const a = (1 - e) * (1 - e)
        const b = 2 * (1 - e) * e
        const c = e * e
        point[0] = a * point[0]! + b * skyVia[i * 2]! + c * skyTarget[i * 3]!
        point[1] = a * point[1]! + b * skyVia[i * 2 + 1]! + c * skyTarget[i * 3 + 1]!
        point[2] = point[2]! * (1 - e) + Math.sin(p * Math.PI) * 3
        // В полёте звезда разгорается, у блока — гаснет, вливаясь в него.
        bright = 1 + 0.4 * e
        glow = 1 - clamp01((local - TRAVEL_MS + ABSORB_LEAD_MS) / ABSORB_MS)
      }
      skyPositions.set(point, i * 3)
      skyColors[i * 4] = Math.min(1, skyBase[i * 3]! * bright)
      skyColors[i * 4 + 1] = Math.min(1, skyBase[i * 3 + 1]! * bright)
      skyColors[i * 4 + 2] = Math.min(1, skyBase[i * 3 + 2]! * bright)
      skyColors[i * 4 + 3] = glow
    }
    skyGeometry.attributes.position!.needsUpdate = true
    skyGeometry.attributes.color!.needsUpdate = true
  }

  // ── Связи между скоплениями и импульсы по ним ───────────────────────────
  const [left, right] = clusters as [(typeof clusters)[number], (typeof clusters)[number]]
  const links: Array<[InstanceType<typeof THREE.Vector3>, InstanceType<typeof THREE.Vector3>]> = []
  for (let i = 0; i < LINKS; i += 1) {
    const a = left.anchors[Math.floor(Math.random() * left.anchors.length)]
    const b = right.anchors[Math.floor(Math.random() * right.anchors.length)]
    if (a && b) links.push([a, b])
  }
  const linePositions = new Float32Array(links.length * 6)
  const lineColors = new Float32Array(links.length * 6)
  const violet = new THREE.Color(BRAND_VIOLET)
  const pink = new THREE.Color(BRAND_PINK)
  links.forEach((_, i) => lineColors.set([...violet.toArray(), ...pink.toArray()], i * 6))
  const lineGeometry = new THREE.BufferGeometry()
  lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3))
  lineGeometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3))
  const lineMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  world.add(new THREE.LineSegments(lineGeometry, lineMaterial))
  geometries.push(lineGeometry)

  const pulsePositions = new Float32Array(links.length * 3)
  const pulseGeometry = new THREE.BufferGeometry()
  pulseGeometry.setAttribute('position', new THREE.BufferAttribute(pulsePositions, 3))
  const pulseMaterial = pointsMaterial(0.22, { color: 0xd6ccff })
  world.add(new THREE.Points(pulseGeometry, pulseMaterial))
  geometries.push(pulseGeometry)
  const phases = links.map(() => Math.random())
  const speeds = links.map(() => 0.12 + Math.random() * 0.18)

  /** Связи и импульсы — по текущему положению скоплений: при слиянии они сжимаются. */
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const updateLinks = (time: number) => {
    links.forEach(([fromAnchor, toAnchor], i) => {
      a.copy(fromAnchor).multiplyScalar(left.group.scale.x).add(left.group.position)
      b.copy(toAnchor).multiplyScalar(right.group.scale.x).add(right.group.position)
      linePositions.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6)
      const t = (phases[i]! + time * speeds[i]!) % 1
      pulsePositions.set([a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t], i * 3)
    })
    lineGeometry.attributes.position!.needsUpdate = true
    pulseGeometry.attributes.position!.needsUpdate = true
  }

  /** `value` — всё небо; `knot` — скопления, связи и импульсы (растворяются в ядре). */
  const setOpacity = (value: number, knot = value) => {
    clusterMaterial.opacity = knot
    coreMaterial.opacity = knot
    fieldMaterial.opacity = value
    lineMaterial.opacity = knot * 0.16
    pulseMaterial.opacity = knot
  }

  let pointerX = 0
  let pointerY = 0
  let width = options.width
  let height = options.height
  const start = performance.now()
  let warpSince: number | null = null
  const meetLeft = new THREE.Vector3(-0.4, 0.2, 0)
  const meetRight = new THREE.Vector3(0.4, -0.2, 0)

  return {
    pointer(x, y) {
      pointerX = x
      pointerY = y
    },
    resize(nextWidth, nextHeight) {
      width = nextWidth
      height = nextHeight
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
      if (reduced) renderer.render(scene, camera)
    },
    warp(now) {
      if (warpSince !== null) return
      warpSince = now
      // В прыжке звёзды летят — плотность пикселей 1 незаметна глазу,
      // а заливки крупных светящихся точек на видеокарте втрое меньше.
      renderer.setPixelRatio(1)
      renderer.setSize(width, height, false)
    },
    assemble(now, targets, screenW, screenH) {
      if (warpSince === null || assembleAt !== null || targets.length === 0) return
      // После запасного разлёта собирать уже нечем.
      if (releaseAt !== null) return
      assembleAt = now - warpSince
      assemblyEnd = assembleAt + planTargets(targets, screenW, screenH, camera.position.z)
    },
    release(now) {
      if (warpSince === null || assembleAt !== null || releaseAt !== null) return
      releaseAt = now - warpSince
    },
    still() {
      setOpacity(1)
      world.rotation.set(0.05, 0.1, 0)
      updateLinks(0.4)
      renderer.render(scene, camera)
    },
    frame(now) {
      const time = (now - start) / 1000
      const intro = 1 - Math.pow(1 - Math.min(1, time / 1.8), 3)

      const t = warpSince === null ? 0 : now - warpSince

      // 1. Воронка: звёзды экрана закручиваются к центру, скопления сливаются.
      const merge = easeInOut(clamp01(t / GATHER_MS))
      left.group.position.lerpVectors(left.home, meetLeft, merge)
      right.group.position.lerpVectors(right.home, meetRight, merge)
      const squeeze = 1 - 0.55 * merge
      left.group.scale.setScalar(squeeze)
      right.group.scale.setScalar(squeeze)
      // Запасной разлёт — только если страница так и не пришла.
      if (warpSince !== null && assembleAt === null && releaseAt === null && t > HOLD_LIMIT_MS) releaseAt = t
      const burst = releaseAt !== null ? easeIn(clamp01((t - releaseAt) / BURST_MS)) : 0
      updateSky(t, merge, burst, time)
      camera.position.z = 26 - 12 * intro
      // Точки не раздуваются: крупные светящиеся точки во весь экран — лишняя
      // заливка для видеокарты, конец прыжка от неё подтормаживал.
      clusterMaterial.size = 0.11
      fieldMaterial.size = 0.11 * (1 + 0.5 * merge) * (1 + 1.2 * burst)
      coreMaterial.size = 1.4 * (1 + 1.2 * merge)
      // Покачивание гасится к прыжку: в центр смотрим прямо.
      const sway = 1 - merge
      world.rotation.y += ((pointerX * 0.35 + Math.sin(time * 0.15) * 0.12) * sway - world.rotation.y) * 0.06
      world.rotation.x += ((pointerY * 0.22 + Math.cos(time * 0.12) * 0.05) * sway - world.rotation.x) * 0.06
      world.rotation.z = merge * 0.9

      // 2. Скопления и связи растворяются в ядре; дальше движутся звёзды неба.
      const knot = warpSince === null ? 1 : 1 - clamp01((t - DISSOLVE_FROM_MS) / DISSOLVE_MS)
      const sky = releaseAt !== null ? 1 - clamp01((t - releaseAt - BURST_MS * 0.4) / (BURST_MS * 0.6)) : 1
      setOpacity(intro * sky, intro * knot)

      const done =
        warpSince !== null && (assembleAt !== null ? t >= assemblyEnd : releaseAt !== null && t >= releaseAt + BURST_MS)
      updateLinks(time)
      renderer.render(scene, camera)
      return done
    },
    dispose() {
      geometries.forEach((geometry) => geometry.dispose())
      ;[clusterMaterial, coreMaterial, fieldMaterial, lineMaterial, pulseMaterial].forEach((material) =>
        material.dispose(),
      )
      dot.dispose()
      renderer.dispose()
    },
  }
}
