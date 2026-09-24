'use client'

import { useEffect, useRef } from 'react'
import styles from './login.module.css'

/**
 * 3D-созвездие «Вузы × IT-компании» за экраном входа (07, раздел 31: Three.js —
 * только для необязательной картинки входа и только с запасным вариантом).
 *
 * Два скопления светящихся точек — вузы вверху слева, IT-компании внизу справа, —
 * между ними тонкие связи, по связям бегут импульсы: знак SkillLink в пространстве.
 * Сцена покачивается и поворачивается за курсором; при появлении камера подлетает.
 *
 * Вход — «варп в систему» (решение 72):
 * 1. скопления летят навстречу и сливаются в центре — связь установлена;
 * 2. камера ныряет сквозь ядро, звёзды растягиваются навстречу, вспышка;
 * 3. из вспышки проступает сайт — его рабочая область выплывает из глубины
 *    (продолжение — `.arrival` в ui/layout/Shell.module.css).
 * Экран входа уходит на середине прыжка, поэтому холст на время прыжка
 * переносится в `body` поверх всего и доигрывает уже над сайтом, а потом гаснет
 * и освобождает ресурсы сам.
 *
 * Бережно к устройству (навык ui-ux-pro-max, раздел Three.js): библиотека
 * грузится динамическим import() только здесь и после показа страницы; частицы —
 * `Points` на `BufferGeometry`, ~2,4 тыс. (вдвое меньше на узком экране); плотность
 * пикселей ≤ 1,5; во скрытой вкладке кадры не считаются. «Уменьшить движение» —
 * один неподвижный кадр и вход без прыжка; нет WebGL — сцены нет.
 */

const LINKS = 28
const BRAND_VIOLET = 0x8e6cff
const BRAND_PINK = 0xed5aa7
const LIGHT = 0xf3f1ed

/** Прыжок целиком: слияние, нырок, вспышка, угасание над сайтом. */
const WARP_MS = 1500
/** Пик вспышки — доля прыжка, когда свет почти закрывает экран. */
const FLASH_PEAK = 0.6
/**
 * Когда экран входа меняется на сайт: чуть раньше пика вспышки. Сборка главной
 * на мгновение занимает браузер, и рывок звёзд в этот момент закрыт светом.
 */
export const WARP_NAVIGATE_MS = Math.round(WARP_MS * (FLASH_PEAK - 0.05))
/** Доли прыжка: к этому моменту скопления слились… */
const MERGE_END = 0.42
/** …с этого камера ныряет… */
const DIVE_START = 0.3
/** …а с этого холст гаснет, открывая сайт. */
const FADE_START = 0.72

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

export function Constellation() {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let unmounted = false
    // Прыжок начался: холст передан сайту и уберёт себя сам.
    let handedOff = false
    let dispose = () => {}

    void import('three').then((THREE) => {
      if (unmounted) return

      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const narrow = window.innerWidth < 720
      const scale = narrow ? 0.5 : 1

      let renderer: InstanceType<typeof THREE.WebGLRenderer>
      try {
        renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'low-power' })
      } catch {
        return // WebGL недоступен — остаётся обычный фон страницы.
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
      renderer.setSize(window.innerWidth, window.innerHeight)
      host.appendChild(renderer.domElement)
      // Метка для формы входа: прыжок будет — переход на сайт ждёт пика вспышки.
      if (!reduced) document.body.dataset.warp = 'ready'

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100)
      camera.position.set(0, 0, reduced ? 14 : 26)

      const world = new THREE.Group()
      // Скопления — в пустых углах экрана, связи — по диагонали через свободную
      // середину: ни заголовок, ни форму сцена не пересекает.
      world.position.set(0, 0, -1.5)
      scene.add(world)

      // Мягкая круглая точка: текстура рисуется один раз на холсте.
      const dotCanvas = document.createElement('canvas')
      dotCanvas.width = dotCanvas.height = 64
      const ctx = dotCanvas.getContext('2d')
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
          color.copy(hub.from).lerp(hub.to, t).multiplyScalar(0.75 + 0.5 * (1 - t))
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

      // ── Рассеянное поле — звёздная пыль вокруг ──────────────────────────────
      const fieldSize = Math.round(600 * scale)
      const fieldPositions = new Float32Array(fieldSize * 3)
      const fieldColors = new Float32Array(fieldSize * 3)
      for (let i = 0; i < fieldSize; i += 1) {
        fieldPositions.set([(Math.random() - 0.5) * 22, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12 - 2], i * 3)
        color.set(BRAND_VIOLET).multiplyScalar(0.25 + Math.random() * 0.25)
        fieldColors.set([color.r, color.g, color.b], i * 3)
      }
      const fieldGeometry = new THREE.BufferGeometry()
      fieldGeometry.setAttribute('position', new THREE.BufferAttribute(fieldPositions, 3))
      fieldGeometry.setAttribute('color', new THREE.BufferAttribute(fieldColors, 3))
      const fieldMaterial = pointsMaterial(0.11, { vertexColors: true })
      const field = new THREE.Points(fieldGeometry, fieldMaterial)
      world.add(field)
      geometries.push(fieldGeometry)

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

      const setOpacity = (value: number) => {
        clusterMaterial.opacity = value
        coreMaterial.opacity = value
        fieldMaterial.opacity = value
        lineMaterial.opacity = value * 0.16
        pulseMaterial.opacity = value
      }

      // ── Поворот за курсором ─────────────────────────────────────────────────
      let pointerX = 0
      let pointerY = 0
      const onPointer = (event: PointerEvent) => {
        pointerX = event.clientX / window.innerWidth - 0.5
        pointerY = event.clientY / window.innerHeight - 0.5
      }
      window.addEventListener('pointermove', onPointer, { passive: true })

      const onResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight
        camera.updateProjectionMatrix()
        renderer.setSize(window.innerWidth, window.innerHeight)
        if (reduced) renderer.render(scene, camera)
      }
      window.addEventListener('resize', onResize)

      // Вспышка прыжка — слой поверх холста, создаётся при передаче холста сайту.
      let flash: HTMLDivElement | null = null
      let frame = 0
      let disposed = false
      dispose = () => {
        if (disposed) return
        disposed = true
        cancelAnimationFrame(frame)
        window.removeEventListener('pointermove', onPointer)
        window.removeEventListener('resize', onResize)
        geometries.forEach((geometry) => geometry.dispose())
        ;[clusterMaterial, coreMaterial, fieldMaterial, lineMaterial, pulseMaterial].forEach((material) =>
          material.dispose(),
        )
        dot.dispose()
        renderer.dispose()
        renderer.domElement.remove()
        flash?.remove()
        delete document.body.dataset.warp
      }

      if (reduced) {
        // Неподвижный кадр: та же картина, без движения; вход — без прыжка.
        setOpacity(1)
        world.rotation.set(0.05, 0.1, 0)
        updateLinks(0.4)
        renderer.render(scene, camera)
        return
      }

      const start = performance.now()
      let warpSince: number | null = null
      const meetLeft = new THREE.Vector3(-0.4, 0.2, 0)
      const meetRight = new THREE.Vector3(0.4, -0.2, 0)

      /** Холст — поверх всего, в body: экран входа уйдёт, а прыжок доиграет над сайтом. */
      const handOff = () => {
        handedOff = true
        // В прыжке звёзды летят — плотность пикселей 1 незаметна глазу, а заливки
        // крупных светящихся точек на видеокарте становится втрое меньше.
        renderer.setPixelRatio(1)
        renderer.setSize(window.innerWidth, window.innerHeight)
        renderer.domElement.className = styles.warpCanvas ?? ''
        document.body.appendChild(renderer.domElement)
        flash = document.createElement('div')
        flash.className = styles.warpFlash ?? ''
        flash.setAttribute('aria-hidden', 'true')
        document.body.appendChild(flash)
      }

      const loop = (now: number) => {
        frame = requestAnimationFrame(loop)
        // Во скрытой вкладке кадры не считаются — кроме прыжка: он должен доиграть и убрать себя.
        if (document.hidden && warpSince === null) return
        const time = (now - start) / 1000
        const intro = 1 - Math.pow(1 - Math.min(1, time / 1.8), 3)

        if (document.body.dataset.authLeaving && warpSince === null) {
          warpSince = now
          handOff()
        }
        const warp = warpSince === null ? 0 : clamp01((now - warpSince) / WARP_MS)

        // 1. Слияние: скопления летят навстречу друг другу к центру.
        const merge = easeInOut(clamp01(warp / MERGE_END))
        left.group.position.lerpVectors(left.home, meetLeft, merge)
        right.group.position.lerpVectors(right.home, meetRight, merge)
        const squeeze = 1 - 0.35 * merge
        left.group.scale.setScalar(squeeze)
        right.group.scale.setScalar(squeeze)

        // 2. Нырок: камера проходит сквозь ядро, звёзды растут и летят навстречу.
        const dive = easeIn(clamp01((warp - DIVE_START) / (1 - DIVE_START)))
        camera.position.z = 26 - 12 * intro - 17 * dive
        field.position.z = 16 * dive
        const stretch = 1 + 3 * dive
        clusterMaterial.size = 0.11 * stretch
        fieldMaterial.size = 0.11 * stretch
        // Покачивание гасится к прыжку: в центр смотрим прямо.
        const sway = 1 - merge
        world.rotation.y += ((pointerX * 0.35 + Math.sin(time * 0.15) * 0.12) * sway - world.rotation.y) * 0.06
        world.rotation.x += ((pointerY * 0.22 + Math.cos(time * 0.12) * 0.05) * sway - world.rotation.x) * 0.06
        world.rotation.z = dive * 0.6

        // 3. Угасание над сайтом.
        const fade = clamp01((warp - FADE_START) / (1 - FADE_START))
        setOpacity(intro * (1 - fade))
        if (warpSince !== null) renderer.domElement.style.opacity = String(1 - fade)
        if (flash) {
          // Вспышка — пик в момент прохода сквозь ядро.
          // Шире и плотнее, чем нужно для красоты: под ней меняется страница.
          const peak = Math.max(0, 1 - Math.abs(warp - FLASH_PEAK) / 0.24)
          flash.style.opacity = String(Math.min(1, peak * 1.15) * 0.94)
        }

        updateLinks(time)
        renderer.render(scene, camera)

        if (warp >= 1) dispose()
      }
      frame = requestAnimationFrame(loop)
    })

    return () => {
      unmounted = true
      // Прыжок идёт над сайтом — холст уберёт себя сам, когда доиграет.
      if (!handedOff) dispose()
    }
  }, [])

  return <div ref={hostRef} className={styles.constellation} aria-hidden="true" />
}
