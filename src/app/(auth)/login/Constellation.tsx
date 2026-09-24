'use client'

import { useEffect, useRef } from 'react'
import styles from './login.module.css'

/**
 * 3D-созвездие «Вузы × IT-компании» за экраном входа (07, раздел 31: Three.js —
 * только для необязательной картинки входа и только с запасным вариантом).
 *
 * Два скопления светящихся точек — вузы вверху слева, IT-компании внизу справа, — между ними
 * тонкие связи, по связям бегут импульсы: знак SkillLink, разложенный в пространство.
 * Сцена медленно покачивается и поворачивается за курсором; при появлении камера
 * подлетает издалека, после входа — пролетает сквозь созвездие в приложение.
 *
 * Бережно к устройству (навык ui-ux-pro-max, раздел Three.js):
 * - Three.js подгружается отдельно и только здесь — к остальному сайту не добавляется;
 * - частицы — одним `Points` на `BufferGeometry`, всего ~2,4 тыс. (1,2 тыс. на узком экране);
 * - плотность пикселей не выше 1,5, кадры не считаются во скрытой вкладке;
 * - «уменьшить движение» — один неподвижный кадр; нет WebGL — сцены нет,
 *   остаётся обычный фон страницы.
 */

const LINKS = 28
const BRAND_VIOLET = 0x8e6cff
const BRAND_PINK = 0xed5aa7
const LIGHT = 0xf3f1ed

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
    let disposed = false
    let cleanup = () => {}

    void import('three').then((THREE) => {
      if (disposed) return

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

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100)
      camera.position.set(0, 0, reduced ? 14 : 26)

      const world = new THREE.Group()
      // Скопления — в пустых углах экрана (вузы — вверху слева над описанием,
      // IT-компании — внизу справа под формой), связи — по диагонали через
      // свободную середину: ни заголовок, ни форму сцена не пересекает.
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

      const hubs = [
        { center: new THREE.Vector3(narrow ? -2.4 : -6.2, narrow ? 4.2 : 3.6, 0), from: new THREE.Color(LIGHT), to: new THREE.Color(BRAND_VIOLET) },
        { center: new THREE.Vector3(narrow ? 2.4 : 7.4, narrow ? -4.2 : -4.6, -0.6), from: new THREE.Color(BRAND_VIOLET), to: new THREE.Color(BRAND_PINK) },
      ]

      // ── Скопления и рассеянное поле ─────────────────────────────────────────
      const clusterSize = Math.round(900 * scale)
      const fieldSize = Math.round(600 * scale)
      const total = clusterSize * 2 + fieldSize
      const positions = new Float32Array(total * 3)
      const colors = new Float32Array(total * 3)
      const color = new THREE.Color()
      const anchors: InstanceType<typeof THREE.Vector3>[][] = [[], []]
      let cursor = 0
      hubs.forEach((hub, hubIndex) => {
        for (let i = 0; i < clusterSize; i += 1) {
          const x = hub.center.x + gaussian() * 1.5
          const y = hub.center.y + gaussian() * 1.15
          const z = hub.center.z + gaussian() * 1.5
          positions.set([x, y, z], cursor * 3)
          const t = Math.min(1, Math.hypot(x - hub.center.x, y - hub.center.y, z - hub.center.z) / 2.4)
          color.copy(hub.from).lerp(hub.to, t).multiplyScalar(0.75 + 0.5 * (1 - t))
          colors.set([color.r, color.g, color.b], cursor * 3)
          // Ядро скопления — концы связей.
          if (t < 0.35 && anchors[hubIndex]!.length < 120) anchors[hubIndex]!.push(new THREE.Vector3(x, y, z))
          cursor += 1
        }
      })
      for (let i = 0; i < fieldSize; i += 1) {
        positions.set([(Math.random() - 0.5) * 22, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12 - 2], cursor * 3)
        color.set(BRAND_VIOLET).multiplyScalar(0.25 + Math.random() * 0.25)
        colors.set([color.r, color.g, color.b], cursor * 3)
        cursor += 1
      }
      const starsGeometry = new THREE.BufferGeometry()
      starsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      starsGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      const starsMaterial = new THREE.PointsMaterial({
        size: 0.11,
        map: dot,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      world.add(new THREE.Points(starsGeometry, starsMaterial))

      // ── Центры скоплений — две точки знака SkillLink ────────────────────────
      const hubGeometry = new THREE.BufferGeometry()
      hubGeometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array([...hubs[0]!.center.toArray(), ...hubs[1]!.center.toArray()]), 3),
      )
      hubGeometry.setAttribute(
        'color',
        new THREE.BufferAttribute(new Float32Array([...new THREE.Color(LIGHT).toArray(), ...new THREE.Color(BRAND_VIOLET).toArray()]), 3),
      )
      const hubMaterial = new THREE.PointsMaterial({
        size: 1.4,
        map: dot,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      world.add(new THREE.Points(hubGeometry, hubMaterial))

      // ── Связи между скоплениями и импульсы по ним ───────────────────────────
      const links: Array<[InstanceType<typeof THREE.Vector3>, InstanceType<typeof THREE.Vector3>]> = []
      for (let i = 0; i < LINKS; i += 1) {
        const a = anchors[0]![Math.floor(Math.random() * anchors[0]!.length)]
        const b = anchors[1]![Math.floor(Math.random() * anchors[1]!.length)]
        if (a && b) links.push([a, b])
      }
      const linePositions = new Float32Array(links.length * 6)
      const lineColors = new Float32Array(links.length * 6)
      const violet = new THREE.Color(BRAND_VIOLET)
      const pink = new THREE.Color(BRAND_PINK)
      links.forEach(([a, b], i) => {
        linePositions.set([...a.toArray(), ...b.toArray()], i * 6)
        lineColors.set([...violet.toArray(), ...pink.toArray()], i * 6)
      })
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

      const pulsePositions = new Float32Array(links.length * 3)
      const pulseGeometry = new THREE.BufferGeometry()
      pulseGeometry.setAttribute('position', new THREE.BufferAttribute(pulsePositions, 3))
      const pulseMaterial = new THREE.PointsMaterial({
        size: 0.22,
        map: dot,
        color: 0xd6ccff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      world.add(new THREE.Points(pulseGeometry, pulseMaterial))
      const phases = links.map(() => Math.random())
      const speeds = links.map(() => 0.12 + Math.random() * 0.18)

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

      const setOpacity = (value: number) => {
        starsMaterial.opacity = value
        hubMaterial.opacity = value
        lineMaterial.opacity = value * 0.16
        pulseMaterial.opacity = value
      }

      const updatePulses = (time: number) => {
        links.forEach(([a, b], i) => {
          const t = (phases[i]! + time * speeds[i]!) % 1
          pulsePositions[i * 3] = a.x + (b.x - a.x) * t
          pulsePositions[i * 3 + 1] = a.y + (b.y - a.y) * t
          pulsePositions[i * 3 + 2] = a.z + (b.z - a.z) * t
        })
        pulseGeometry.attributes.position!.needsUpdate = true
      }

      let frame = 0
      if (reduced) {
        // Неподвижный кадр: та же картина, без движения.
        setOpacity(1)
        world.rotation.set(0.05, 0.1, 0)
        updatePulses(0.4)
        renderer.render(scene, camera)
      } else {
        const start = performance.now()
        let leavingSince: number | null = null
        const loop = (now: number) => {
          frame = requestAnimationFrame(loop)
          if (document.hidden) return
          const time = (now - start) / 1000
          const intro = Math.min(1, time / 1.8)
          const eased = 1 - Math.pow(1 - intro, 3)

          // После входа — пролёт сквозь созвездие (форма входа уходит за 420 мс).
          if (document.body.dataset.authLeaving && leavingSince === null) leavingSince = now
          const leave = leavingSince === null ? 0 : Math.min(1, (now - leavingSince) / 420)
          const leaveEased = leave * leave

          camera.position.z = 26 - 12 * eased - 11 * leaveEased
          setOpacity(eased * (1 - leaveEased * 0.8))

          // Лёгкое покачивание вместо полного оборота: скопления остаются в своих углах.
          world.rotation.y += (pointerX * 0.35 + Math.sin(time * 0.15) * 0.12 - world.rotation.y) * 0.04
          world.rotation.x += (pointerY * 0.22 + Math.cos(time * 0.12) * 0.05 - world.rotation.x) * 0.04
          updatePulses(time)
          renderer.render(scene, camera)
        }
        frame = requestAnimationFrame(loop)
      }

      cleanup = () => {
        cancelAnimationFrame(frame)
        window.removeEventListener('pointermove', onPointer)
        window.removeEventListener('resize', onResize)
        ;[starsGeometry, hubGeometry, lineGeometry, pulseGeometry].forEach((geometry) => geometry.dispose())
        ;[starsMaterial, hubMaterial, lineMaterial, pulseMaterial].forEach((material) => material.dispose())
        dot.dispose()
        renderer.dispose()
        renderer.domElement.remove()
      }
    })

    return () => {
      disposed = true
      cleanup()
    }
  }, [])

  return <div ref={hostRef} className={styles.constellation} aria-hidden="true" />
}
