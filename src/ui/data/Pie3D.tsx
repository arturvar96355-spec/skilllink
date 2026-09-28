/**
 * Тип тона сектора/колонки — общий для объёмных диаграмм (решение 95).
 *
 * Сам компонент `Pie3D` (объёмная кольцевая диаграмма) удалён: нигде не
 * рендерился, заменён `Donut`. Тип оставлен здесь — его использует `Bars3D`
 * (`src/ui/data/Bars3D.tsx`).
 */
export type Pie3DTone = 'violet' | 'pink' | 'cyan' | 'orange' | 'warning' | 'danger' | 'success' | 'muted'
