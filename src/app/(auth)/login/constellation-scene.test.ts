import { describe, expect, it } from 'vitest'
import { clampSceneSize } from './constellation-scene'

/**
 * Регресс к ошибке в консоли на /login: THREE.BufferGeometry.computeBoundingSphere():
 * Computed radius is NaN — window.innerWidth/innerHeight иногда 0 на первом кадре
 * (скрытая вкладка, страница до layout), и `0 / 0` в аспекте камеры давал NaN
 * во всех координатах звёздного неба. clampSceneSize — единственная защита от этого
 * на обоих путях (Constellation.tsx и createConstellation в constellation-scene.ts).
 */
describe('clampSceneSize', () => {
  it('заменяет 0 на 1 — до фикса аспект камеры уходил в 0 / 0 = NaN', () => {
    expect(clampSceneSize(0)).toBe(1)
  })

  it('заменяет отрицательное значение на 1', () => {
    expect(clampSceneSize(-100)).toBe(1)
  })

  it('не трогает обычный размер окна', () => {
    expect(clampSceneSize(1440)).toBe(1440)
    expect(clampSceneSize(1)).toBe(1)
  })
})
