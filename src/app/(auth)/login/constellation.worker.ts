import * as THREE from 'three'
import {
  createConstellation,
  type AssemblyTarget,
  type ConstellationScene,
  type SceneOptions,
} from './constellation-scene'

/**
 * Фоновый поток созвездия входа (решение 75): сцена рисуется на OffscreenCanvas,
 * и звёзды движутся, даже пока страница занята сборкой сайта после входа.
 */

export type WorkerMessage =
  | ({ type: 'init'; canvas: OffscreenCanvas } & SceneOptions)
  | { type: 'pointer'; x: number; y: number }
  | { type: 'resize'; width: number; height: number }
  | { type: 'visibility'; hidden: boolean }
  | { type: 'warp' }
  | { type: 'release' }
  | {
      type: 'assemble'
      targets: AssemblyTarget[]
      width: number
      height: number
    }
  | { type: 'dispose' }

export type WorkerReply = { type: 'ready' } | { type: 'unsupported' } | { type: 'done' }

/** Нужная часть глобального объекта фонового потока (библиотеки типов webworker в проекте нет). */
interface WorkerScope {
  postMessage(message: WorkerReply): void
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null
  requestAnimationFrame?: (callback: (now: number) => void) => number
  cancelAnimationFrame?: (id: number) => void
  setTimeout(callback: () => void, ms: number): number
  clearTimeout(id: number): void
}

const worker = self as unknown as WorkerScope

let scene: ConstellationScene | null = null
let hidden = false
let warping = false
let timer = 0

// В фоновом потоке requestAnimationFrame есть не везде — тогда таймер на 60 кадров/с.
const nextFrame: (callback: (now: number) => void) => number = worker.requestAnimationFrame
  ? (callback) => worker.requestAnimationFrame!(callback)
  : (callback) => worker.setTimeout(() => callback(performance.now()), 16)
const cancelFrame = (id: number) =>
  worker.cancelAnimationFrame ? worker.cancelAnimationFrame(id) : worker.clearTimeout(id)

function stop() {
  cancelFrame(timer)
  scene?.dispose()
  scene = null
}

function loop(now: number) {
  if (!scene) return
  timer = nextFrame(loop)
  // Во скрытой вкладке кадры не считаются — кроме прыжка: он должен доиграть.
  if (hidden && !warping) return
  if (scene.frame(now)) {
    stop()
    worker.postMessage({ type: 'done' } satisfies WorkerReply)
  }
}

worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data
  switch (message.type) {
    case 'init': {
      scene = createConstellation(THREE, message.canvas, message)
      if (!scene) {
        worker.postMessage({ type: 'unsupported' } satisfies WorkerReply)
        return
      }
      worker.postMessage({ type: 'ready' } satisfies WorkerReply)
      if (message.reduced) scene.still()
      else timer = nextFrame(loop)
      break
    }
    case 'pointer':
      scene?.pointer(message.x, message.y)
      break
    case 'resize':
      scene?.resize(message.width, message.height)
      break
    case 'visibility':
      hidden = message.hidden
      break
    case 'warp':
      warping = true
      scene?.warp(performance.now())
      break
    case 'assemble':
      scene?.assemble(performance.now(), message.targets, message.width, message.height)
      break
    case 'release':
      scene?.release(performance.now())
      break
    case 'dispose':
      stop()
      break
  }
}
