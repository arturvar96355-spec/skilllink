import type { Pie3DTone } from './Pie3D'

/**
 * Типы объёмных столбиков (решение 95). Сам компонент `Bars3D` удалён: нигде
 * не рендерился, заменён `BarsFlat` (решения 198, 201). Типы оставлены —
 * их использует `BarsFlat` (`src/ui/data/BarsFlat.tsx`) и главная страница
 * (`src/app/(app)/page.tsx`).
 */

export interface Bars3DPart {
  key: string
  label: string
  value: number
  tone: Pie3DTone
}

export interface Bars3DGroup {
  key: string
  label: string
  /** Полное название — в подсказке. */
  title: string
  href?: string
  /** Части снизу вверх. */
  parts: Bars3DPart[]
}
